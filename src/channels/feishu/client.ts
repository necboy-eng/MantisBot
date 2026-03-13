import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/loader.js';
import type { FeishuInstanceConfig } from '../../config/schema.js';
import { getFileStorage } from '../../files/index.js';
import type { FileAttachment } from '../../types.js';
import { buildMarkdownCard } from './table-converter.js';

// 禁用代理环境变量，避免 EasyConnect/SSH Proxy 等导致重定向循环
// 这必须在导入 lark SDK 之前执行
if (!process.env.NO_PROXY) {
  process.env.NO_PROXY = '*.feishu.cn,*.larksuite.com,open.feishu.cn';
}
// 清除可能导致问题的代理设置
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

// 使用 any 简化类型，避免复杂的 SDK 类型定义
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wsClient: any = null;
// Bot 自身的 open_id，用于判断群聊中是否被 @到
let botOpenId: string | undefined;

// 消息去重缓存（参考 LobsterAI 实现）
const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5 分钟

/**
 * 检查消息是否已处理过（去重）
 */
function isMessageProcessed(messageId: string): boolean {
  // 先清理过期消息
  cleanupProcessedMessages();

  if (processedMessages.has(messageId)) {
    return true;
  }
  processedMessages.set(messageId, Date.now());
  return false;
}

/**
 * 清理过期的已处理消息缓存
 */
function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(messageId);
    }
  }
}

/**
 * 解析域名配置
 */
function resolveDomain(domain: string | undefined): any {
  if (!domain || domain === 'feishu') return lark.Domain.Feishu;
  if (domain === 'lark') return lark.Domain.Lark;
  // 自定义域名（移除末尾斜杠）
  return domain.replace(/\/+$/, '');
}

/**
 * 探测 Bot 信息，验证配置是否正确
 * 参考 LobsterAI 实现
 */
async function probeBot(): Promise<{ ok: boolean; error?: string; botName?: string; botOpenId?: string }> {
  if (!client) {
    return { ok: false, error: 'Client not initialized' };
  }

  try {
    console.log('[Feishu] Probing bot info...');
    const response: any = await client.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info',
    });

    console.log('[Feishu] Bot probe response:', JSON.stringify(response));

    if (response.code !== 0) {
      return { ok: false, error: response.msg || `code ${response.code}` };
    }

    return {
      ok: true,
      botName: response.bot?.app_name ?? response.data?.app_name ?? response.data?.bot?.app_name,
      botOpenId: response.bot?.open_id ?? response.data?.open_id ?? response.data?.bot?.open_id,
    };
  } catch (err: any) {
    console.error('[Feishu] Bot probe failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export function getFeishuClient(): typeof client {
  const config = getConfig();
  // 从新架构的 config.channels.feishu 读取配置
  const feishuConfig = (config.channels as any)?.feishu;
  if (!feishuConfig?.enabled) {
    console.warn('[Feishu] getFeishuClient: feishu not enabled in config.channels.feishu');
    return null;
  }

  if (!client) {
    const appId = feishuConfig.appId || '';
    const appSecret = feishuConfig.appSecret || '';
    const domain = resolveDomain(feishuConfig.domain);

    if (!appId || !appSecret) {
      console.warn('[Feishu] Missing appId or appSecret in config.channels.feishu');
      return null;
    }
    console.log('[Feishu] Creating Lark client, appId:', appId, 'domain:', feishuConfig.domain || 'feishu');
    client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });
  }

  return client;
}

export function isFeishuEnabled(): boolean {
  const config = getConfig();
  // 同时兼容新配置路径（config.channels.feishu）和旧配置路径（config.feishu）
  const newPath = (config.channels as any)?.feishu?.enabled ?? false;
  const oldPath = (config as any).feishu?.enabled ?? false;
  const result = newPath || oldPath;
  console.log(`[Feishu] isFeishuEnabled: channels.feishu.enabled=${newPath}, feishu.enabled=${oldPath}, result=${result}`);
  return result;
}

/**
 * 启动飞书长连接 WebSocket 客户端
 * 用于接收实时消息事件
 * 参考 LobsterAI 实现，增加预检测和域名配置
 */
export async function startFeishuWSClient(
  onMessage: (message: string, chatId: string, userId: string, messageId: string, attachments?: FileAttachment[]) => Promise<void>
): Promise<void> {
  const config = getConfig();
  // 从新架构的 config.channels.feishu 读取配置
  const feishuConfig = (config.channels as any)?.feishu;

  console.log('[Feishu] startFeishuWSClient called');
  console.log('[Feishu] config.channels?.feishu:', JSON.stringify({ ...feishuConfig, appSecret: '***' }));
  console.log('[Feishu] (legacy) config.feishu:', JSON.stringify({ ...(config as any).feishu, appSecret: '***' }));

  if (!feishuConfig?.enabled) {
    console.log('[Feishu] Integration is disabled (config.channels.feishu.enabled is falsy)');
    return;
  }

  const appId = feishuConfig.appId || '';
  const appSecret = feishuConfig.appSecret || '';
  if (!appId || !appSecret) {
    console.warn('[Feishu] Missing appId or appSecret in config.channels.feishu, skipping WebSocket client');
    return;
  }

  const domain = resolveDomain(feishuConfig.domain);
  const debug = feishuConfig.debug ?? false;

  // 确保创建 REST client（用于发送消息和预检测）
  if (!client) {
    client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });
  }

  // 预检测 Bot 配置是否正确（参考 LobsterAI）
  const probeResult = await probeBot();
  if (!probeResult.ok) {
    console.error(`[Feishu] Bot probe failed: ${probeResult.error}`);
    console.error('[Feishu] Please check your appId and appSecret configuration');
    return;
  }
  console.log(`[Feishu] Bot verified: ${probeResult.botName} (${probeResult.botOpenId})`);
  botOpenId = probeResult.botOpenId;

  // 创建 WSClient 用于长连接
  console.log('[Feishu] Creating WebSocket client, domain:', feishuConfig.domain || 'feishu');
  wsClient = new lark.WSClient({
    appId,
    appSecret,
    domain,
    loggerLevel: debug ? lark.LoggerLevel.debug : lark.LoggerLevel.info,
  });

  console.log('[Feishu] Starting WebSocket client...');
  console.log('[Feishu] AppId:', appId);

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const message = data.message;
        const messageId = message.message_id;

        // 消息去重检查（参考 LobsterAI）
        if (isMessageProcessed(messageId)) {
          console.log(`[Feishu] Duplicate message ignored: ${messageId}`);
          return;
        }

        console.log('[Feishu] Full message data:', JSON.stringify(data, null, 2));

        // 群聊消息：只处理 Bot 本身被 @到的消息，忽略普通群消息
        const isGroupChat = message.chat_type === 'group';
        if (isGroupChat) {
          const mentions: any[] = Array.isArray(message.mentions) ? message.mentions : [];
          const isBotMentioned = mentions.some(
            (m: any) =>
              m.id?.open_id === botOpenId ||
              m.id?.union_id === botOpenId ||
              m.id?.user_id === botOpenId
          );
          if (!isBotMentioned) {
            console.log(`[Feishu] Group message without @bot ignored: ${messageId}`);
            return;
          }
        }

        const chatId = message.chat_id;
        // sender_id 在 data.sender.sender_id（飞书 SDK 2.0 Schema 结构）
        const senderId = data.sender?.sender_id;
        const userId = senderId?.user_id || senderId?.union_id || senderId?.open_id || '';

        // 解析消息内容，并清除 @_user_X 占位符
        let content = '';
        // 飞书 SDK 使用 message_type 字段（不是 msg_type）
        const msgType = message.message_type || message.msg_type;

        // 根据消息类型处理
        if (msgType === 'text' || msgType === 'post') {
          try {
            content = JSON.parse(message.content || '{}').text || '';
          } catch {
            content = message.content || '';
          }
          // 移除飞书 @占位符（如 "@_user_1 "），保留实际文字
          content = content.replace(/@_user_\d+\s*/g, '').trim();
        } else if (msgType === 'image') {
          content = '[图片]';
        } else if (msgType === 'file') {
          const fileContent = JSON.parse(message.content || '{}');
          content = `[文件] ${fileContent.file_name || '未知文件'}`;
        } else if (msgType === 'media') {
          const mediaContent = JSON.parse(message.content || '{}');
          content = `[媒体] ${mediaContent.file_name || '未知媒体'}`;
        } else if (msgType === 'audio') {
          const audioContent = JSON.parse(message.content || '{}');
          content = `[音频] ${audioContent.file_name || '未知音频'}`;
        } else {
          content = `[${msgType}]`;
        }

        console.log(`[Feishu] Received message from ${userId}, chatId: ${chatId}, messageId: ${messageId}, msgType: ${msgType}, content: ${content}`);

        // 处理消息中的媒体附件（图片、文件等）
        let attachments: FileAttachment[] = [];
        if (['image', 'file', 'media', 'audio', 'post'].includes(msgType)) {
          try {
            attachments = await processFeishuMessageMedia(message);
            if (attachments.length > 0) {
              console.log(`[Feishu] Processed ${attachments.length} attachment(s) for message ${messageId}`);
            }
          } catch (err) {
            console.error(`[Feishu] Failed to process message media:`, err);
          }
        }

        // 调用传入的回调函数处理消息
        if (onMessage) {
          await onMessage(content, chatId, userId, messageId, attachments.length > 0 ? attachments : undefined);
        }
      },
      // 添加消息已读事件处理器，消除警告
      'im.message.message_read_v1': async () => {
        // 忽略已读回执
      },
    }),
  });

  console.log('[Feishu] WebSocket client started');
}

export { buildMarkdownCard } from './table-converter.js';

/**
 * 回复指定消息（引用原消息，适用于群聊 @Bot 场景）
 * @param replyToMessageId 被回复的原始消息 ID
 * @param content 回复内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function replyFeishuMessage(
  replyToMessageId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.reply({
    path: { message_id: replyToMessageId },
    data: {
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 发送消息到飞书（支持 Markdown 格式）
 * @param chatId 群聊 ID
 * @param content 消息内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function sendFeishuMessage(
  chatId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 发送消息给指定用户（支持 Markdown 格式）
 * @param userId 用户 ID
 * @param content 消息内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function sendFeishuUserMessage(
  userId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.create({
    params: {
      receive_id_type: 'user_id',
    },
    data: {
      receive_id: userId,
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 上传文件到飞书并发送给群聊
 * 飞书发送文件需要先上传获取 file_key，再发送文件消息
 * attachment.url 格式为 /api/files/{uuid}.ext，对应磁盘 data/uploads/{uuid}.ext
 */
export async function sendFeishuFile(
  chatId: string,
  attachment: FileAttachment
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  // 从 FileStorage 按 url 读取文件内容
  // url 格式：/api/files/{uuid}.ext → storedName = {uuid}.ext
  const storedName = path.basename(attachment.url || '');
  const fileStorage = getFileStorage();
  const fileData = fileStorage.readFile(storedName);

  if (!fileData) {
    console.warn(`[Feishu] Cannot read file from storage: ${attachment.url}, skipping`);
    return;
  }

  const mime = attachment.mimeType || '';

  if (mime.startsWith('image/')) {
    // 图片走 image.create 接口（不带 .v1，参考 OpenClaw 实现）
    console.log(`[Feishu] Uploading image: ${attachment.name} (${fileData.length} bytes)`);
    const uploadResp = await feishu.im.image.create({
      data: { image_type: 'message', image: fileData },
    });
    // SDK v1.30+ 成功时直接返回数据，无 code 包装
    const respAny = uploadResp as any;
    const imageKey = respAny.image_key ?? respAny.data?.image_key;
    if (!imageKey) {
      console.warn('[Feishu] Image upload failed, no image_key returned. Response:', JSON.stringify(respAny));
      return;
    }
    console.log(`[Feishu] Image uploaded, key: ${imageKey}`);
    await feishu.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ image_key: imageKey }),
        msg_type: 'image',
      },
    });
    return;
  }

  // 非图片文件：从文件名扩展名映射飞书 file_type（与 MIME 相比更准确）
  const ext = attachment.name.toLowerCase().split('.').pop() || '';
  let fileType: string;
  if (ext === 'pdf') fileType = 'pdf';
  else if (ext === 'doc' || ext === 'docx') fileType = 'doc';
  else if (ext === 'xls' || ext === 'xlsx') fileType = 'xls';
  else if (ext === 'ppt' || ext === 'pptx') fileType = 'ppt';
  else if (ext === 'mp4' || ext === 'mov' || ext === 'avi') fileType = 'mp4';
  else if (ext === 'opus' || ext === 'ogg') fileType = 'opus';
  else fileType = 'stream';

  console.log(`[Feishu] Uploading file: ${attachment.name} (${fileType}, ${fileData.length} bytes)`);
  // 使用 client.im.file.create（不带 .v1），参考 OpenClaw 实现
  const uploadResp = await feishu.im.file.create({
    data: {
      file_type: fileType,
      file_name: attachment.name,
      file: fileData as any,
    },
  });

  // SDK v1.30+ 成功时直接返回数据，无 code 包装；失败时有 code 字段
  const respAny = uploadResp as any;
  if (respAny.code !== undefined && respAny.code !== 0) {
    throw new Error(`Feishu file upload failed: ${respAny.msg || `code ${respAny.code}`}`);
  }
  const fileKey = respAny.file_key ?? respAny.data?.file_key;
  if (!fileKey) {
    console.warn('[Feishu] File upload failed, no file_key returned. Response:', JSON.stringify(respAny));
    return;
  }

  const isMedia = fileType === 'mp4' || fileType === 'opus';
  console.log(`[Feishu] File uploaded, key: ${fileKey}, sending as msg_type=${isMedia ? 'media' : 'file'}...`);
  await feishu.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ file_key: fileKey }),
      msg_type: isMedia ? 'media' : 'file',
    },
  });
  console.log(`[Feishu] File message sent: ${attachment.name}`);
}

/**
 * 关闭飞书长连接
 */
export function stopFeishuWSClient(): void {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
    console.log('[Feishu] WebSocket client stopped');
  }
}

/**
 * 获取飞书客户端（复用工具模块的客户端管理器）
 */
export async function getFeishuClientForTools(userId?: string): Promise<any> {
  // 动态导入并使用工具模块的客户端管理器
  const feishuModule = await import('../../agents/tools/feishu/client.js');
  return feishuModule.getFeishuClient(userId);
}

// ============================================================
// 媒体下载函数（参考 OpenClaw 实现）
// ============================================================

/**
 * 从飞书 SDK 响应中读取 Buffer
 */
async function readFeishuResponseBuffer(response: any, errorPrefix: string): Promise<Buffer> {
  if (Buffer.isBuffer(response)) {
    return response;
  }
  if (response instanceof ArrayBuffer) {
    return Buffer.from(response);
  }
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`${errorPrefix}: ${response.msg || `code ${response.code}`}`);
  }
  if (response.data && Buffer.isBuffer(response.data)) {
    return response.data;
  }
  if (response.data instanceof ArrayBuffer) {
    return Buffer.from(response.data);
  }
  if (typeof response.getReadableStream === 'function') {
    const stream = response.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof response.writeFile === 'function') {
    // 临时文件方式
    const tmpPath = `/tmp/feishu-download-${Date.now()}`;
    await response.writeFile(tmpPath);
    const buffer = await fs.promises.readFile(tmpPath);
    await fs.promises.unlink(tmpPath).catch(() => {});
    return buffer;
  }
  if (typeof response[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error(`${errorPrefix}: unexpected response format`);
}

/**
 * 下载飞书图片
 * @param imageKey 图片 key
 * @returns 图片 Buffer
 */
export async function downloadFeishuImage(imageKey: string): Promise<Buffer> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  console.log(`[Feishu] Downloading image: ${imageKey}`);
  const response = await feishu.im.image.get({
    path: { image_key: imageKey },
  });

  const buffer = await readFeishuResponseBuffer(response, 'Feishu image download failed');
  console.log(`[Feishu] Image downloaded, size: ${buffer.length} bytes`);
  return buffer;
}

/**
 * 下载飞书消息资源（文件/媒体）
 * @param messageId 消息 ID
 * @param fileKey 文件 key
 * @param type 资源类型
 * @returns 文件 Buffer
 */
export async function downloadFeishuMessageResource(
  messageId: string,
  fileKey: string,
  type: 'image' | 'file'
): Promise<Buffer> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  console.log(`[Feishu] Downloading message resource: ${fileKey} (type: ${type})`);
  const response = await feishu.im.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type },
  });

  const buffer = await readFeishuResponseBuffer(response, 'Feishu message resource download failed');
  console.log(`[Feishu] Message resource downloaded, size: ${buffer.length} bytes`);
  return buffer;
}

/**
 * 处理飞书消息中的媒体附件
 * @param message 飞书消息对象
 * @returns FileAttachment 数组
 */
export async function processFeishuMessageMedia(message: any): Promise<FileAttachment[]> {
  const attachments: FileAttachment[] = [];
  // 兼容 message_type（飞书 SDK 2.0）和 msg_type（旧版/直接字段）
  const msgType = message.message_type || message.msg_type;
  const messageId = message.message_id;

  if (!messageId) {
    return attachments;
  }

  try {
    if (msgType === 'image') {
      // 图片消息：必须使用消息资源接口下载（用户发来的图片），
      // 而非 im.image.get（只能下载机器人自己上传的图片）
      const content = JSON.parse(message.content || '{}');
      const imageKey = content.image_key;
      if (imageKey) {
        const buffer = await downloadFeishuMessageResource(messageId, imageKey, 'image');
        const fileStorage = getFileStorage();
        const attachment = fileStorage.saveFile(`feishu-image-${imageKey}.jpg`, buffer, 'image/jpeg');
        attachments.push({
          id: attachment.id,
          name: `feishu-image-${imageKey}.jpg`,
          mimeType: 'image/jpeg',
          size: buffer.length,
          url: attachment.url,
        });
        console.log(`[Feishu] Saved image attachment: ${attachment.id}`);
      }
    } else if (msgType === 'file' || msgType === 'media' || msgType === 'audio') {
      // 文件/媒体消息
      const content = JSON.parse(message.content || '{}');
      const fileKey = content.file_key;
      const fileName = content.file_name || `feishu-file-${fileKey}`;

      if (fileKey) {
        const resourceType = msgType === 'file' ? 'file' : 'image';
        const buffer = await downloadFeishuMessageResource(messageId, fileKey, resourceType);
        const fileStorage = getFileStorage();

        // 根据文件扩展名确定 MIME 类型
        const ext = path.extname(fileName).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        else if (['.doc', '.docx'].includes(ext)) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (['.xls', '.xlsx'].includes(ext)) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (['.ppt', '.pptx'].includes(ext)) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        else if (['.mp4', '.mov', '.avi'].includes(ext)) mimeType = 'video/mp4';
        else if (['.mp3', '.wav', '.ogg', '.opus'].includes(ext)) mimeType = 'audio/ogg';

        const attachment = fileStorage.saveFile(fileName, buffer, mimeType);
        attachments.push({
          id: attachment.id,
          name: fileName,
          mimeType,
          size: buffer.length,
          url: attachment.url,
        });
        console.log(`[Feishu] Saved file attachment: ${attachment.id} (${fileName})`);
      }
    } else if (msgType === 'post') {
      // 富文本消息：可能包含嵌入图片
      const content = JSON.parse(message.content || '{}');
      // 解析富文本中的图片（简化版，只提取图片 key）
      const imageKeys = extractImageKeysFromPost(content);
      for (const imageKey of imageKeys) {
        try {
          const buffer = await downloadFeishuMessageResource(messageId, imageKey, 'image');
          const fileStorage = getFileStorage();
          const attachment = fileStorage.saveFile(`feishu-post-img-${imageKey}.jpg`, buffer, 'image/jpeg');
          attachments.push({
            id: attachment.id,
            name: `feishu-post-img-${imageKey}.jpg`,
            mimeType: 'image/jpeg',
            size: buffer.length,
            url: attachment.url,
          });
          console.log(`[Feishu] Saved post embedded image: ${attachment.id}`);
        } catch (err) {
          console.error(`[Feishu] Failed to download post image ${imageKey}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('[Feishu] Failed to process message media:', error);
  }

  return attachments;
}

/**
 * 从飞书富文本内容中提取图片 key
 */
function extractImageKeysFromPost(content: any): string[] {
  const keys: string[] = [];

  function traverse(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    // 图片对象通常包含 image_key
    if (obj.image_key) {
      keys.push(obj.image_key);
    }

    // 递归遍历
    if (Array.isArray(obj)) {
      obj.forEach(traverse);
    } else {
      Object.values(obj).forEach(traverse);
    }
  }

  traverse(content);
  return keys;
}

// ── 多实例辅助函数（内部使用，不导出）────────────────────────────────────────

/**
 * 使用指定 lark client 处理消息媒体附件（多实例版本）
 * 通过临时替换模块级 client 变量来复用现有 processFeishuMessageMedia 逻辑
 */
async function processFeishuMessageMediaWithClient(
  message: any,
  larkClient: any
): Promise<FileAttachment[]> {
  const originalClient = client;
  client = larkClient;
  try {
    return await processFeishuMessageMedia(message);
  } finally {
    client = originalClient;
  }
}

/**
 * 使用指定 lark client 发送文件（多实例版本）
 */
async function sendFeishuFileWithClient(
  chatId: string,
  attachment: FileAttachment,
  larkClient: any
): Promise<void> {
  const originalClient = client;
  client = larkClient;
  try {
    await sendFeishuFile(chatId, attachment);
  } finally {
    client = originalClient;
  }
}

// ── FeishuClient 类（多实例支持）────────────────────────────────────────────

export type FeishuMessageHandler = (
  message: string,
  chatId: string,
  userId: string,
  messageId: string,
  attachments?: FileAttachment[]
) => Promise<void>;

export class FeishuClient {
  private instanceId: string;
  private config: FeishuInstanceConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private larkClient: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wsClientInstance: any = null;
  private botOpenId: string | undefined;
  private processedMessages: Map<string, number> = new Map();
  private readonly MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

  constructor(config: FeishuInstanceConfig) {
    this.instanceId = config.id;
    this.config = config;
  }

  private isProcessed(messageId: string): boolean {
    const now = Date.now();
    for (const [id, ts] of this.processedMessages) {
      if (now - ts > this.MESSAGE_DEDUP_TTL) this.processedMessages.delete(id);
    }
    if (this.processedMessages.has(messageId)) return true;
    this.processedMessages.set(messageId, now);
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveDomainForInstance(domain?: string): any {
    if (!domain || domain === 'feishu') return lark.Domain.Feishu;
    if (domain === 'lark') return lark.Domain.Lark;
    return domain.replace(/\/+$/, '');
  }

  async start(onMessage: FeishuMessageHandler): Promise<void> {
    const { appId, appSecret, domain, debug } = this.config;
    const tag = `[FeishuClient:${this.instanceId}]`;

    if (!appId || !appSecret) {
      console.warn(`${tag} Missing appId or appSecret, skipping start`);
      return;
    }

    const resolvedDomain = this.resolveDomainForInstance(domain);

    // 创建 REST client
    this.larkClient = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: resolvedDomain,
    });

    // 预检测 bot
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await this.larkClient.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });
      if (resp.code !== 0) {
        console.error(`${tag} Bot probe failed: ${resp.msg}`);
        return;
      }
      this.botOpenId = resp.bot?.open_id ?? resp.data?.open_id ?? resp.data?.bot?.open_id;
      const botName = resp.bot?.app_name ?? resp.data?.app_name ?? resp.data?.bot?.app_name;
      console.log(`${tag} Bot verified: ${botName} (${this.botOpenId})`);
    } catch (err: any) {
      console.error(`${tag} Bot probe error: ${err.message}`);
      return;
    }

    // 创建 WSClient
    this.wsClientInstance = new lark.WSClient({
      appId,
      appSecret,
      domain: resolvedDomain,
      loggerLevel: debug ? lark.LoggerLevel.debug : lark.LoggerLevel.info,
    });

    const capturedBotOpenId = this.botOpenId;

    this.wsClientInstance.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          const message = data.message;
          const messageId = message.message_id;

          if (this.isProcessed(messageId)) {
            console.log(`${tag} Duplicate message ignored: ${messageId}`);
            return;
          }

          // 群聊 @bot 检查
          const isGroupChat = message.chat_type === 'group';
          if (isGroupChat) {
            const mentions: any[] = Array.isArray(message.mentions) ? message.mentions : [];
            const isBotMentioned = mentions.some(
              (m: any) =>
                m.id?.open_id === capturedBotOpenId ||
                m.id?.union_id === capturedBotOpenId ||
                m.id?.user_id === capturedBotOpenId
            );
            if (!isBotMentioned) {
              console.log(`${tag} Group message without @bot ignored: ${messageId}`);
              return;
            }
          }

          const chatId = message.chat_id;
          const senderId = data.sender?.sender_id;
          const userId = senderId?.user_id || senderId?.union_id || senderId?.open_id || '';
          const msgType = message.message_type || message.msg_type;

          let content = '';
          if (msgType === 'text' || msgType === 'post') {
            try { content = JSON.parse(message.content || '{}').text || ''; } catch { content = message.content || ''; }
            content = content.replace(/@_user_\d+\s*/g, '').trim();
          } else if (msgType === 'image') {
            content = '[图片]';
          } else if (msgType === 'file') {
            content = `[文件] ${JSON.parse(message.content || '{}').file_name || '未知文件'}`;
          } else if (msgType === 'media') {
            content = `[媒体] ${JSON.parse(message.content || '{}').file_name || '未知媒体'}`;
          } else if (msgType === 'audio') {
            content = `[音频] ${JSON.parse(message.content || '{}').file_name || '未知音频'}`;
          } else {
            content = `[${msgType}]`;
          }

          console.log(`${tag} Message from ${userId}, chatId: ${chatId}, type: ${msgType}`);

          // 处理媒体附件
          let attachments: FileAttachment[] = [];
          if (['image', 'file', 'media', 'audio', 'post'].includes(msgType)) {
            try {
              attachments = await processFeishuMessageMediaWithClient(message, this.larkClient);
            } catch (err) {
              console.error(`${tag} Error processing attachments:`, err);
            }
          }

          await onMessage(content, chatId, userId, messageId, attachments);
        },
      }),
    });

    console.log(`${tag} Started`);
  }

  async stop(): Promise<void> {
    if (this.wsClientInstance) {
      try { (this.wsClientInstance as any).stop?.(); } catch { /* ignore */ }
      this.wsClientInstance = null;
    }
    this.larkClient = null;
    console.log(`[FeishuClient:${this.instanceId}] Stopped`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLarkClient(): any {
    return this.larkClient;
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    if (!this.larkClient) throw new Error(`[FeishuClient:${this.instanceId}] Not started`);
    await this.larkClient.request({
      method: 'POST',
      url: '/open-apis/im/v1/messages',
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      },
    });
  }

  async replyMessage(messageId: string, message: string): Promise<void> {
    if (!this.larkClient) throw new Error(`[FeishuClient:${this.instanceId}] Not started`);
    await this.larkClient.request({
      method: 'POST',
      url: `/open-apis/im/v1/messages/${messageId}/reply`,
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      },
    });
  }

  async sendFile(chatId: string, attachment: FileAttachment): Promise<void> {
    if (!this.larkClient) throw new Error(`[FeishuClient:${this.instanceId}] Not started`);
    await sendFeishuFileWithClient(chatId, attachment, this.larkClient);
  }
}
