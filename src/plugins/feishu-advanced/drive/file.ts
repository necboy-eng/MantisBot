// src/plugins/feishu-advanced/drive/file.ts

/**
 * feishu_drive_file tool -- 飞书云空间文件管理
 *
 * Actions: list, get_meta, copy, move, delete, upload, download
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// 分片上传配置
const SMALL_FILE_THRESHOLD = 15 * 1024 * 1024; // 15MB，小于此大小使用一次上传

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuDriveFileSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'get_meta', 'copy', 'move', 'delete', 'upload', 'download'],
      description: '操作类型',
    },
    // list action 参数
    folder_token: {
      type: 'string',
      description:
        '文件夹 token（可选）。不填写或填空字符串时，获取用户云空间根目录下的清单（注意：根目录模式不支持分页和返回快捷方式）',
    },
    page_size: { type: 'number', description: '分页大小（默认 200，最大 200）' },
    page_token: { type: 'string', description: '分页标记。首次请求无需填写' },
    order_by: {
      type: 'string',
      enum: ['EditedTime', 'CreatedTime'],
      description: '排序方式：EditedTime（编辑时间）、CreatedTime（创建时间）',
    },
    direction: {
      type: 'string',
      enum: ['ASC', 'DESC'],
      description: '排序方向：ASC（升序）、DESC（降序）',
    },
    // get_meta action 参数
    request_docs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doc_token: { type: 'string', description: '文档 token' },
          doc_type: {
            type: 'string',
            enum: ['doc', 'sheet', 'file', 'bitable', 'docx', 'folder', 'mindnote', 'slides'],
            description: '文档类型',
          },
        },
        required: ['doc_token', 'doc_type'],
      },
      description:
        "要查询的文档列表（批量查询，最多 50 个）。示例：[{doc_token: 'xxx', doc_type: 'sheet'}]",
    },
    // copy action 参数
    file_token: { type: 'string', description: '文件 token（必填）' },
    name: { type: 'string', description: '目标文件名（copy 时必填）' },
    type: {
      type: 'string',
      enum: ['doc', 'sheet', 'file', 'bitable', 'docx', 'folder', 'mindnote', 'slides'],
      description: '文档类型（copy/move/delete 时必填）',
    },
    // copy/move 目标文件夹
    parent_node: {
      type: 'string',
      description: '【folder_token 的别名】目标文件夹 token（为兼容性保留）',
    },
    // upload action 参数
    file_path: {
      type: 'string',
      description:
        '本地文件路径（与 file_content_base64 二选一）。优先使用此参数，会自动读取文件内容、计算大小、提取文件名。',
    },
    file_content_base64: {
      type: 'string',
      description: '文件内容的 Base64 编码（与 file_path 二选一）',
    },
    file_name: { type: 'string', description: '文件名（使用 file_content_base64 时必填）' },
    size: { type: 'number', description: '文件大小（字节，使用 file_content_base64 时必填）' },
    // download action 参数
    output_path: {
      type: 'string',
      description:
        "本地保存的完整文件路径（可选）。必须包含文件名和扩展名，例如 '/tmp/file.pdf'。如果不提供，则返回 Base64 编码的文件内容。",
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerDriveFileTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_drive_file',
    description:
      '【以用户身份】飞书云空间文件管理工具。当用户要求查看云空间(云盘)中的文件列表、获取文件信息、复制/移动/删除文件、上传/下载文件时使用。消息中的文件读写**禁止**使用该工具!' +
      '\n\nActions:' +
      '\n- list（列出文件）：列出文件夹下的文件。不提供 folder_token 时获取根目录清单' +
      "\n- get_meta（批量获取元数据）：批量查询文档元信息，使用 request_docs 数组参数，格式：[{doc_token: '...', doc_type: 'sheet'}]" +
      '\n- copy（复制文件）：复制文件到指定位置' +
      '\n- move（移动文件）：移动文件到指定文件夹' +
      '\n- delete（删除文件）：删除文件' +
      '\n- upload（上传文件）：上传本地文件到云空间。提供 file_path（本地文件路径）或 file_content_base64（Base64 编码）' +
      '\n- download（下载文件）：下载文件到本地。提供 output_path（本地保存路径）则保存到本地，否则返回 Base64 编码' +
      '\n\n【重要】copy/move/delete 操作需要 file_token 和 type 参数。get_meta 使用 request_docs 数组参数。' +
      '\n【重要】upload 优先使用 file_path（自动读取文件、提取文件名和大小），也支持 file_content_base64（需手动提供 file_name 和 size）。' +
      '\n【重要】download 提供 output_path 时保存到本地，不提供则返回 Base64。',
    parameters: FeishuDriveFileSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'drive_file' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // LIST FILES
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[drive_file] list: folder_token=${p.folder_token || '(root)'}, page_size=${p.page_size ?? 200}`);

            const res = await client.invoke(
              'feishu_drive_file.list',
              (sdk, opts) =>
                sdk.drive.file.list(
                  {
                    params: {
                      folder_token: p.folder_token as any,
                      page_size: p.page_size as any,
                      page_token: p.page_token,
                      order_by: p.order_by as any,
                      direction: p.direction as any,
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(res);

            logger.info(`[drive_file] list: returned ${res.data?.files?.length ?? 0} files`);

            const data = res.data as any;
            return json({
              files: data?.files,
              has_more: data?.has_more,
              page_token: data?.next_page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET META
          // -----------------------------------------------------------------
          case 'get_meta': {
            if (!p.request_docs || !Array.isArray(p.request_docs) || p.request_docs.length === 0) {
              return json({
                error:
                  "request_docs must be a non-empty array. Correct format: {action: 'get_meta', request_docs: [{doc_token: '...', doc_type: 'sheet'}]}",
              });
            }

            logger.info(`[drive_file] get_meta: querying ${p.request_docs.length} documents`);

            const res = await client.invoke(
              'feishu_drive_file.get_meta',
              (sdk, opts) =>
                sdk.drive.meta.batchQuery(
                  {
                    data: {
                      request_docs: p.request_docs as any,
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(res);

            logger.info(`[drive_file] get_meta: returned ${res.data?.metas?.length ?? 0} metas`);

            return json({
              metas: res.data?.metas ?? [],
            });
          }

          // -----------------------------------------------------------------
          // COPY FILE
          // -----------------------------------------------------------------
          case 'copy': {
            if (!p.file_token) {
              return json({ error: 'file_token is required for copy action' });
            }
            if (!p.name) {
              return json({ error: 'name is required for copy action' });
            }
            if (!p.type) {
              return json({ error: 'type is required for copy action' });
            }

            // 兼容处理：parent_node 作为 folder_token 的别名
            const targetFolderToken = p.folder_token || p.parent_node;

            logger.info(
              `[drive_file] copy: file_token=${p.file_token}, name=${p.name}, type=${p.type}, folder_token=${targetFolderToken ?? '(root)'}`,
            );

            const res = await client.invoke(
              'feishu_drive_file.copy',
              (sdk, opts) =>
                sdk.drive.file.copy(
                  {
                    path: { file_token: p.file_token },
                    data: {
                      name: p.name,
                      type: p.type as any,
                      folder_token: targetFolderToken as any,
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[drive_file] copy: new file_token=${data?.file?.token ?? 'unknown'}`);

            return json({
              file: data?.file,
            });
          }

          // -----------------------------------------------------------------
          // MOVE FILE
          // -----------------------------------------------------------------
          case 'move': {
            if (!p.file_token) {
              return json({ error: 'file_token is required for move action' });
            }
            if (!p.type) {
              return json({ error: 'type is required for move action' });
            }
            if (!p.folder_token) {
              return json({ error: 'folder_token is required for move action' });
            }

            logger.info(`[drive_file] move: file_token=${p.file_token}, type=${p.type}, folder_token=${p.folder_token}`);

            const res = await client.invoke(
              'feishu_drive_file.move',
              (sdk, opts) =>
                sdk.drive.file.move(
                  {
                    path: { file_token: p.file_token },
                    data: {
                      type: p.type as any,
                      folder_token: p.folder_token,
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[drive_file] move: task_id=${data?.task_id}`);

            return json({
              success: true,
              task_id: data?.task_id,
              file_token: p.file_token,
              target_folder_token: p.folder_token,
            });
          }

          // -----------------------------------------------------------------
          // DELETE FILE
          // -----------------------------------------------------------------
          case 'delete': {
            if (!p.file_token) {
              return json({ error: 'file_token is required for delete action' });
            }
            if (!p.type) {
              return json({ error: 'type is required for delete action' });
            }

            logger.info(`[drive_file] delete: file_token=${p.file_token}, type=${p.type}`);

            const res = await client.invoke(
              'feishu_drive_file.delete',
              (sdk, opts) =>
                sdk.drive.file.delete(
                  {
                    path: { file_token: p.file_token },
                    params: {
                      type: p.type as any,
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[drive_file] delete: task_id=${data?.task_id}`);

            return json({
              success: true,
              task_id: data?.task_id,
              file_token: p.file_token,
            });
          }

          // -----------------------------------------------------------------
          // UPLOAD FILE
          // -----------------------------------------------------------------
          case 'upload': {
            let fileBuffer: Buffer;
            let fileName: string;
            let fileSize: number;

            // 优先使用 file_path
            if (p.file_path) {
              logger.info(`[drive_file] upload: reading from local file: ${p.file_path}`);

              try {
                // 读取文件内容
                fileBuffer = await fs.readFile(p.file_path);

                // 提取文件名（如果未提供）
                fileName = p.file_name || path.basename(p.file_path);

                // 计算文件大小（如果未提供）
                fileSize = p.size || fileBuffer.length;

                logger.info(`[drive_file] upload: file_name=${fileName}, size=${fileSize}, parent=${p.parent_node || '(root)'}`);
              } catch (err) {
                return json({
                  error: `failed to read local file: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            } else if (p.file_content_base64) {
              // 使用 base64 内容
              if (!p.file_name || !p.size) {
                return json({
                  error: 'file_name and size are required when using file_content_base64',
                });
              }

              logger.info(
                `[drive_file] upload: using base64 content, file_name=${p.file_name}, size=${p.size}, parent=${p.parent_node}`,
              );

              // Decode base64 to buffer
              fileBuffer = Buffer.from(p.file_content_base64, 'base64');
              fileName = p.file_name;
              fileSize = p.size;
            } else {
              return json({
                error: 'either file_path or file_content_base64 is required',
              });
            }

            // 根据文件大小选择上传方式
            if (fileSize <= SMALL_FILE_THRESHOLD) {
              // 小文件：使用一次上传
              logger.info(`[drive_file] upload: using upload_all (file size ${fileSize} <= 15MB)`);

              const res: any = await client.invoke(
                'feishu_drive_file.upload',
                (sdk, opts) =>
                  sdk.drive.file.uploadAll(
                    {
                      data: {
                        file_name: fileName,
                        parent_type: 'explorer' as any,
                        parent_node: p.parent_node || '',
                        size: fileSize,
                        file: fileBuffer as any,
                      },
                    },
                    opts,
                  ),
                { as: 'user' },
              );
              assertLarkOk(res);

              logger.info(`[drive_file] upload: file_token=${res.data?.file_token}`);

              return json({
                file_token: res.data?.file_token,
                file_name: fileName,
                size: fileSize,
              });
            } else {
              // 大文件：使用分片上传
              logger.info(`[drive_file] upload: using chunked upload (file size ${fileSize} > 15MB)`);

              // 1. 预上传
              logger.info(`[drive_file] upload: step 1 - prepare upload`);
              const prepareRes: any = await client.invoke(
                'feishu_drive_file.upload',
                (sdk, opts) =>
                  sdk.drive.file.uploadPrepare(
                    {
                      data: {
                        file_name: fileName,
                        parent_type: 'explorer' as any,
                        parent_node: p.parent_node || '',
                        size: fileSize,
                      },
                    },
                    opts,
                  ),
                { as: 'user' },
              );

              logger.info(`[drive_file] upload: prepareRes = ${JSON.stringify(prepareRes)}`);

              if (!prepareRes) {
                return json({ error: 'pre-upload failed: empty response' });
              }

              assertLarkOk(prepareRes);

              const { upload_id, block_size, block_num } = prepareRes.data;
              logger.info(`[drive_file] upload: got upload_id=${upload_id}, block_num=${block_num}, block_size=${block_size}`);

              // 2. 上传分片
              logger.info(`[drive_file] upload: step 2 - uploading ${block_num} chunks`);
              for (let seq = 0; seq < block_num; seq++) {
                const start = seq * block_size;
                const end = Math.min(start + block_size, fileSize);
                const chunkBuffer = fileBuffer.subarray(start, end);

                logger.info(`[drive_file] upload: uploading chunk ${seq + 1}/${block_num} (${chunkBuffer.length} bytes)`);

                await client.invoke(
                  'feishu_drive_file.upload',
                  (sdk, opts) =>
                    sdk.drive.file.uploadPart(
                      {
                        data: {
                          upload_id: String(upload_id),
                          seq: Number(seq),
                          size: Number(chunkBuffer.length),
                          file: chunkBuffer,
                        },
                      },
                      opts,
                    ),
                  { as: 'user' },
                );

                logger.info(`[drive_file] upload: chunk ${seq + 1}/${block_num} uploaded successfully`);
              }

              // 3. 完成上传
              logger.info(`[drive_file] upload: step 3 - finish upload`);
              const finishRes: any = await client.invoke(
                'feishu_drive_file.upload',
                (sdk, opts) =>
                  sdk.drive.file.uploadFinish(
                    {
                      data: {
                        upload_id,
                        block_num,
                      },
                    },
                    opts,
                  ),
                { as: 'user' },
              );
              assertLarkOk(finishRes);

              logger.info(`[drive_file] upload: file_token=${finishRes.data?.file_token}`);

              return json({
                file_token: finishRes.data?.file_token,
                file_name: fileName,
                size: fileSize,
                upload_method: 'chunked',
                chunks_uploaded: block_num,
              });
            }
          }

          // -----------------------------------------------------------------
          // DOWNLOAD FILE
          // -----------------------------------------------------------------
          case 'download': {
            if (!p.file_token) {
              return json({ error: 'file_token is required for download action' });
            }

            logger.info(`[drive_file] download: file_token=${p.file_token}`);

            const res: any = await client.invoke(
              'feishu_drive_file.download',
              (sdk, opts) =>
                sdk.drive.file.download(
                  {
                    path: { file_token: p.file_token },
                  },
                  opts,
                ),
              { as: 'user' },
            );

            // File download returns Buffer through getReadableStream
            const stream = res.getReadableStream();
            const chunks: Buffer[] = [];

            for await (const chunk of stream) {
              chunks.push(chunk);
            }

            const fileBuffer = Buffer.concat(chunks);

            logger.info(`[drive_file] download: file size=${fileBuffer.length} bytes`);

            // 如果提供了 output_path，保存到本地文件
            if (p.output_path) {
              try {
                // output_path 必须是完整文件路径
                // 确保父目录存在
                await fs.mkdir(path.dirname(p.output_path), { recursive: true });

                // 写入文件
                await fs.writeFile(p.output_path, fileBuffer);

                logger.info(`[drive_file] download: saved to ${p.output_path}`);

                return json({
                  saved_path: p.output_path,
                  size: fileBuffer.length,
                });
              } catch (err) {
                return json({
                  error: `failed to save file: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            } else {
              // 没有提供 output_path，返回 base64
              const base64Content = fileBuffer.toString('base64');

              return json({
                file_content_base64: base64Content,
                size: fileBuffer.length,
              });
            }
          }

          default:
            return json({
              error: `Unknown action: ${p.action}`,
            });
        }
      } catch (err: any) {
        // 处理授权错误
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }

        logger.error(`[drive_file] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[drive] Registered feishu_drive_file tool');
}