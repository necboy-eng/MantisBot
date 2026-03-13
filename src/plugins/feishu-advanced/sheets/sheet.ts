// src/plugins/feishu-advanced/sheets/sheet.ts

/**
 * feishu_sheet tool -- 飞书电子表格统一工具
 *
 * Actions: info, read, write, append, find, create, export
 *
 * 设计原则：
 *   - 接受 URL 或 spreadsheet_token（工具层自动解析）
 *   - read 不指定 range 时自动读取第一个工作表全部数据
 *   - create 支持带表头和初始数据一步创建
 *   - info 一次返回表格信息 + 全部工作表列表
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_READ_ROWS = 200;
const MAX_WRITE_ROWS = 5000;
const MAX_WRITE_COLS = 100;
const EXPORT_POLL_INTERVAL_MS = 1000;
const EXPORT_POLL_MAX_RETRIES = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从飞书电子表格 URL 中解析 token 和可选的 sheet_id。
 *
 * 支持格式：
 *   https://www.feishu.cn/sheets/TOKEN
 *   https://xxx.feishu.cn/sheets/TOKEN?sheet=SHEET_ID
 *   https://xxx.feishu.cn/wiki/TOKEN（知识库中的电子表格）
 */
function parseSheetUrl(url: string): { token: string; sheetId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(?:sheets|wiki)\/([^/?#]+)/);
    if (!match) return null;
    return {
      token: match[1],
      sheetId: u.searchParams.get('sheet') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 飞书已知的 token 类型前缀。
 * 新版 token：第 5/10/15 位字符（1-indexed）组成前缀。
 * 旧版 token：前 3 个字符即为前缀。
 *
 * 常见类型：dox=云文档, sht=电子表格, bas=多维表格, wik=知识库
 */
const KNOWN_TOKEN_TYPES = new Set([
  'dox',
  'doc',
  'sht',
  'bas',
  'app',
  'sld',
  'bmn',
  'fld',
  'nod',
  'box',
  'jsn',
  'img',
  'isv',
  'wik',
  'wia',
  'wib',
  'wic',
  'wid',
  'wie',
  'dsb',
]);

/**
 * 从 token 中提取类型前缀（如 "sht"、"wik"、"doc" 等）。
 * 先检测新版格式（第 5/10/15 位），再回退旧版格式（前 3 位）。
 */
function getTokenType(token: string): string | null {
  if (token.length >= 15) {
    const prefix = token[4] + token[9] + token[14];
    if (KNOWN_TOKEN_TYPES.has(prefix)) return prefix;
  }
  if (token.length >= 3) {
    const prefix = token.substring(0, 3);
    if (KNOWN_TOKEN_TYPES.has(prefix)) return prefix;
  }
  return null;
}

/**
 * 从参数中解析 spreadsheet_token（支持 url 和直接 token 两种方式）。
 * 如果检测到 wiki token，自动通过 wiki API 获取真实的 spreadsheet_token。
 */
async function resolveToken(
  p: { url?: string; spreadsheet_token?: string },
  client: any,
  logger: any
): Promise<{
  token: string;
  urlSheetId?: string;
}> {
  let token: string;
  let urlSheetId: string | undefined;

  if (p.spreadsheet_token) {
    token = p.spreadsheet_token;
  } else if (p.url) {
    const parsed = parseSheetUrl(p.url);
    if (!parsed) {
      throw new Error(`Failed to parse spreadsheet_token from URL: ${p.url}`);
    }
    token = parsed.token;
    urlSheetId = parsed.sheetId;
  } else {
    throw new Error('url or spreadsheet_token is required');
  }

  // 检测 wiki token 并解析为真实的 spreadsheet_token
  const tokenType = getTokenType(token);
  if (tokenType === 'wik') {
    logger.info(`resolveToken: detected wiki token, resolving obj_token...`);
    const wikiNodeRes = await client.invoke(
      'feishu_sheet.info',
      (sdk: any, opts: any) =>
        sdk.wiki.space.getNode(
          {
            params: {
              token,
              obj_type: 'wiki',
            },
          },
          opts
        ),
      { as: 'user' }
    );
    assertLarkOk(wikiNodeRes);
    const objToken = wikiNodeRes.data?.node?.obj_token;
    if (!objToken) {
      throw new Error(`Failed to resolve spreadsheet token from wiki token: ${token}`);
    }
    logger.info(`resolveToken: wiki resolved ${token} -> ${objToken}`);
    token = objToken;
  }

  return { token, urlSheetId };
}

/**
 * Resolve the target range for read/write/append operations.
 *
 * Priority: explicit range > sheet_id param / URL sheet > first sheet via API.
 * Throws if the spreadsheet has no worksheets.
 */
async function resolveRange(
  token: string,
  range: string | undefined,
  sheetId: string | undefined,
  client: any,
  apiName: string
): Promise<string> {
  if (range) return range;
  if (sheetId) return sheetId;

  const sheetsRes = await client.invoke(
    apiName,
    (sdk: any, opts: any) => sdk.sheets.spreadsheetSheet.query({ path: { spreadsheet_token: token } }, opts),
    { as: 'user' }
  );
  assertLarkOk(sheetsRes);
  const firstSheet = (sheetsRes.data?.sheets ?? [])[0];
  if (!firstSheet?.sheet_id) {
    throw new Error('spreadsheet has no worksheets');
  }
  return firstSheet.sheet_id;
}

/**
 * 将列号（1-based）转换为 Excel 列字母（A, B, ..., Z, AA, AB, ...）。
 */
function colLetter(n: number): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * 将单元格值中的富文本 segment 数组拍平为纯文本字符串。
 *
 * 飞书 Sheets API 对带样式的单元格返回 [{type:"text", text:"...", segmentStyle:{...}}, ...] 格式，
 * 极其冗余。此函数将其拼接为单个字符串，大幅减少 token 消耗。
 */
function flattenCellValue(cell: unknown): unknown {
  if (!Array.isArray(cell)) return cell;
  // 检测是否为富文本 segment 数组：每个元素都是 {text: string, ...} 对象
  if (cell.length > 0 && cell.every((seg) => seg != null && typeof seg === 'object' && 'text' in seg)) {
    return cell.map((seg: any) => seg.text).join('');
  }
  return cell;
}

function flattenValues(values: unknown[][] | undefined): unknown[][] | undefined {
  if (!values) return values;
  return values.map((row) => row.map(flattenCellValue));
}

function truncateRows(
  values: unknown[][] | undefined,
  maxRows: number
): {
  values: unknown[][] | undefined;
  truncated: boolean;
  total_rows: number;
} {
  if (!values) return { values, truncated: false, total_rows: 0 };
  const total = values.length;
  if (total <= maxRows) return { values, truncated: false, total_rows: total };
  return { values: values.slice(0, maxRows), truncated: true, total_rows: total };
}

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuSheetSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['info', 'read', 'write', 'append', 'find', 'create', 'export'],
      description: '操作类型',
    },
    url: {
      type: 'string',
      description:
        '电子表格 URL，例如 https://xxx.feishu.cn/sheets/TOKEN 或 https://xxx.feishu.cn/wiki/TOKEN（与 spreadsheet_token 二选一）',
    },
    spreadsheet_token: {
      type: 'string',
      description: '电子表格 token（与 url 二选一）',
    },
    range: {
      type: 'string',
      description:
        '范围（可选）。格式：<sheetId>!A1:D10 或 <sheetId>（sheetId 通过 info 获取）。不填则自动操作第一个工作表',
    },
    sheet_id: {
      type: 'string',
      description: '工作表 ID（可选）。仅当不提供 range 时生效，指定要操作的工作表。不填则使用第一个工作表',
    },
    value_render_option: {
      type: 'string',
      enum: ['ToString', 'FormattedValue', 'Formula', 'UnformattedValue'],
      description:
        '值渲染方式：ToString（默认）、FormattedValue（按格式）、Formula（公式）、UnformattedValue（原始值）',
    },
    values: {
      type: 'array',
      items: {
        type: 'array',
        items: {},
      },
      description: '二维数组，每个元素是一行。例如 [["姓名","年龄"],["张三",25]]',
    },
    title: {
      type: 'string',
      description: '电子表格标题（create 时使用）',
    },
    folder_token: {
      type: 'string',
      description: '文件夹 token（可选）。不填时创建到「我的空间」根目录',
    },
    headers: {
      type: 'array',
      items: { type: 'string' },
      description: '表头列名（可选）。例如 ["姓名", "部门", "入职日期"]。提供后会写入第一行',
    },
    data: {
      type: 'array',
      items: {
        type: 'array',
        items: {},
      },
      description: '初始数据（可选）。二维数组，写在表头之后。例如 [["张三", "工程", "2026-01-01"]]',
    },
    find: {
      type: 'string',
      description: '查找内容（字符串或正则表达式）',
    },
    match_case: {
      type: 'boolean',
      description: '是否区分大小写（默认 true）',
    },
    match_entire_cell: {
      type: 'boolean',
      description: '是否完全匹配整个单元格（默认 false）',
    },
    search_by_regex: {
      type: 'boolean',
      description: '是否使用正则表达式（默认 false）',
    },
    include_formulas: {
      type: 'boolean',
      description: '是否搜索公式（默认 false）',
    },
    file_extension: {
      type: 'string',
      enum: ['xlsx', 'csv'],
      description: '导出格式：xlsx 或 csv',
    },
    output_path: {
      type: 'string',
      description: '本地保存路径（含文件名）。不填则只返回文件信息',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerSheetTool(registry: ToolRegistry, context: PluginToolContext): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_sheet',
    description:
      '【以用户身份】飞书电子表格工具。支持创建、读写、查找、导出电子表格。\n\n' +
      '电子表格（Sheets）类似 Excel/Google Sheets，与多维表格（Bitable/Airtable）是不同产品。\n\n' +
      '所有 action（除 create 外）均支持传入 url 或 spreadsheet_token，工具会自动解析。支持知识库 wiki URL，自动解析为电子表格 token。\n\n' +
      'Actions:\n' +
      '- info：获取表格信息 + 全部工作表列表（一次调用替代 get_info + list_sheets）\n' +
      '- read：读取数据。不填 range 自动读取第一个工作表全部数据\n' +
      '- write：覆盖写入,高危,请谨慎使用该操作。不填 range 自动写入第一个工作表（从 A1 开始）\n' +
      '- append：在已有数据末尾追加行\n' +
      '- find：在工作表中查找单元格\n' +
      '- create：创建电子表格。支持带 headers + data 一步创建含数据的表格\n' +
      '- export：导出为 xlsx 或 csv（csv 必须指定 sheet_id）',
    parameters: FeishuSheetSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'sheet' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // INFO — 表格信息 + 全部工作表列表
          // -----------------------------------------------------------------
          case 'info': {
            const { token } = await resolveToken(p, client, logger);
            logger.info(`[sheet] info: token=${token}`);

            // 并行请求表格信息和工作表列表
            const [spreadsheetRes, sheetsRes] = await Promise.all([
              client.invoke<{ data?: { spreadsheet?: any } }>(
                'feishu_sheet.info',
                (sdk: any, opts: any) =>
                  sdk.sheets.spreadsheet.get({ path: { spreadsheet_token: token } }, opts),
                { as: 'user' }
              ),
              client.invoke<{ data?: { sheets?: any[] } }>(
                'feishu_sheet.info',
                (sdk: any, opts: any) =>
                  sdk.sheets.spreadsheetSheet.query({ path: { spreadsheet_token: token } }, opts),
                { as: 'user' }
              ),
            ]);
            assertLarkOk(spreadsheetRes);
            assertLarkOk(sheetsRes);

            const spreadsheet = spreadsheetRes.data?.spreadsheet;
            const sheets = (sheetsRes.data?.sheets ?? []).map((s: any) => ({
              sheet_id: s.sheet_id,
              title: s.title,
              index: s.index,
              row_count: s.grid_properties?.row_count,
              column_count: s.grid_properties?.column_count,
              frozen_row_count: s.grid_properties?.frozen_row_count,
              frozen_column_count: s.grid_properties?.frozen_column_count,
            }));

            logger.info(`[sheet] info: title="${spreadsheet?.title}", ${sheets.length} sheets`);

            return json({
              title: spreadsheet?.title,
              spreadsheet_token: token,
              url: `https://www.feishu.cn/sheets/${token}`,
              sheets,
            });
          }

          // -----------------------------------------------------------------
          // READ — 读取数据（支持自动探测范围）
          // -----------------------------------------------------------------
          case 'read': {
            const { token, urlSheetId } = await resolveToken(p, client, logger);
            const range = await resolveRange(
              token,
              p.range,
              p.sheet_id ?? urlSheetId,
              client,
              'feishu_sheet.read'
            );

            logger.info(`[sheet] read: token=${token}, range=${range}`);

            const query: Record<string, string> = {
              // 默认返回计算后的值（而非公式原文），日期转为可读字符串
              valueRenderOption: p.value_render_option ?? 'ToString',
              dateTimeRenderOption: 'FormattedString',
            };

            const res = await client.invokeByPath<{
              code?: number;
              msg?: string;
              data?: {
                revision?: number;
                spreadsheetToken?: string;
                valueRange?: {
                  majorDimension?: string;
                  range?: string;
                  revision?: number;
                  values?: unknown[][];
                };
              };
            }>(
              'feishu_sheet.read',
              `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
              { method: 'GET', query, as: 'user' }
            );

            if (res.code && res.code !== 0) {
              return json({ error: res.msg || `API error code: ${res.code}` });
            }

            const valueRange = res.data?.valueRange;
            const { values, truncated, total_rows } = truncateRows(
              flattenValues(valueRange?.values),
              MAX_READ_ROWS
            );

            logger.info(
              `[sheet] read: ${total_rows} rows${truncated ? ` (truncated to ${MAX_READ_ROWS})` : ''}`
            );

            return json({
              range: valueRange?.range,
              values,
              ...(truncated
                ? {
                    truncated: true,
                    total_rows,
                    hint: `Data exceeds ${MAX_READ_ROWS} rows, truncated. Please narrow the range and read again.`,
                  }
                : {}),
            });
          }

          // -----------------------------------------------------------------
          // WRITE — 覆盖写入（支持自动 range）
          // -----------------------------------------------------------------
          case 'write': {
            const { token, urlSheetId } = await resolveToken(p, client, logger);

            if (p.values && p.values.length > MAX_WRITE_ROWS) {
              return json({ error: `write row count ${p.values.length} exceeds limit ${MAX_WRITE_ROWS}` });
            }
            if (p.values && p.values.some((row: unknown[]) => Array.isArray(row) && row.length > MAX_WRITE_COLS)) {
              return json({ error: `write column count exceeds limit ${MAX_WRITE_COLS}` });
            }

            const range = await resolveRange(
              token,
              p.range,
              p.sheet_id ?? urlSheetId,
              client,
              'feishu_sheet.write'
            );

            logger.info(`[sheet] write: token=${token}, range=${range}, rows=${p.values?.length}`);

            const res = await client.invokeByPath<{
              code?: number;
              msg?: string;
              data?: {
                spreadsheetToken?: string;
                updatedRange?: string;
                updatedRows?: number;
                updatedColumns?: number;
                updatedCells?: number;
                revision?: number;
              };
            }>('feishu_sheet.write', `/open-apis/sheets/v2/spreadsheets/${token}/values`, {
              method: 'PUT',
              body: { valueRange: { range, values: p.values } },
              as: 'user',
            });

            if (res.code && res.code !== 0) {
              return json({ error: res.msg || `API error code: ${res.code}` });
            }

            logger.info(`[sheet] write: updated ${res.data?.updatedCells ?? 0} cells`);

            return json({
              updated_range: res.data?.updatedRange,
              updated_rows: res.data?.updatedRows,
              updated_columns: res.data?.updatedColumns,
              updated_cells: res.data?.updatedCells,
              revision: res.data?.revision,
            });
          }

          // -----------------------------------------------------------------
          // APPEND — 追加行
          // -----------------------------------------------------------------
          case 'append': {
            const { token, urlSheetId } = await resolveToken(p, client, logger);

            if (p.values && p.values.length > MAX_WRITE_ROWS) {
              return json({ error: `append row count ${p.values.length} exceeds limit ${MAX_WRITE_ROWS}` });
            }

            const range = await resolveRange(
              token,
              p.range,
              p.sheet_id ?? urlSheetId,
              client,
              'feishu_sheet.append'
            );

            logger.info(`[sheet] append: token=${token}, range=${range}, rows=${p.values?.length}`);

            const res = await client.invokeByPath<{
              code?: number;
              msg?: string;
              data?: {
                spreadsheetToken?: string;
                tableRange?: string;
                revision?: number;
                updates?: {
                  spreadsheetToken?: string;
                  updatedRange?: string;
                  updatedRows?: number;
                  updatedColumns?: number;
                  updatedCells?: number;
                  revision?: number;
                };
              };
            }>('feishu_sheet.append', `/open-apis/sheets/v2/spreadsheets/${token}/values_append`, {
              method: 'POST',
              body: { valueRange: { range, values: p.values } },
              as: 'user',
            });

            if (res.code && res.code !== 0) {
              return json({ error: res.msg || `API error code: ${res.code}` });
            }

            const updates = res.data?.updates;
            logger.info(`[sheet] append: updated ${updates?.updatedCells ?? 0} cells`);

            return json({
              table_range: res.data?.tableRange,
              updated_range: updates?.updatedRange,
              updated_rows: updates?.updatedRows,
              updated_columns: updates?.updatedColumns,
              updated_cells: updates?.updatedCells,
              revision: updates?.revision,
            });
          }

          // -----------------------------------------------------------------
          // FIND — 查找单元格
          // -----------------------------------------------------------------
          case 'find': {
            const { token } = await resolveToken(p, client, logger);
            logger.info(`[sheet] find: token=${token}, sheet_id=${p.sheet_id}, find="${p.find}"`);

            const findCondition: Record<string, unknown> = {
              range: p.range ? `${p.sheet_id}!${p.range}` : p.sheet_id,
            };
            if (p.match_case !== undefined) findCondition.match_case = !p.match_case; // oapi问题, 实际true表示不用区分, false表示需要区分,所以要取反
            if (p.match_entire_cell !== undefined) findCondition.match_entire_cell = p.match_entire_cell;
            if (p.search_by_regex !== undefined) findCondition.search_by_regex = p.search_by_regex;
            if (p.include_formulas !== undefined) findCondition.include_formulas = p.include_formulas;

            const res = await client.invoke<{ data?: { find_result?: any } }>(
              'feishu_sheet.find',
              (sdk: any, opts: any) =>
                sdk.sheets.spreadsheetSheet.find(
                  {
                    path: {
                      spreadsheet_token: token,
                      sheet_id: p.sheet_id,
                    },
                    data: {
                      find_condition: findCondition as any,
                      find: p.find,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const findResult = res.data?.find_result;
            logger.info(`[sheet] find: matched ${findResult?.matched_cells?.length ?? 0} cells`);

            return json({
              matched_cells: findResult?.matched_cells,
              matched_formula_cells: findResult?.matched_formula_cells,
              rows_count: findResult?.rows_count,
            });
          }

          // -----------------------------------------------------------------
          // CREATE — 创建电子表格（支持带初始数据）
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.title) {
              return json({ error: 'title is required for create action' });
            }

            logger.info(
              `[sheet] create: title="${p.title}", folder=${p.folder_token ?? '(root)'}, headers=${!!p.headers}, data=${p.data?.length ?? 0} rows`
            );

            // Step 1: 创建电子表格
            const createRes = await client.invoke<{ data?: { spreadsheet?: { spreadsheet_token?: string } } }>(
              'feishu_sheet.create',
              (sdk: any, opts: any) =>
                sdk.sheets.spreadsheet.create(
                  {
                    data: {
                      title: p.title,
                      folder_token: p.folder_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(createRes);

            const spreadsheet = createRes.data?.spreadsheet;
            const token = spreadsheet?.spreadsheet_token;
            if (!token) {
              return json({ error: 'failed to create spreadsheet: no token returned' });
            }

            const url = `https://www.feishu.cn/sheets/${token}`;
            logger.info(`[sheet] create: token=${token}`);

            // Step 2: 如果有 headers 或 data，写入初始数据
            if (p.headers || p.data) {
              const allRows: unknown[][] = [];
              if (p.headers) allRows.push(p.headers);
              if (p.data) allRows.push(...p.data);

              if (allRows.length > 0) {
                // 查询默认工作表的 sheet_id
                const sheetsRes = await client.invoke<{ data?: { sheets?: any[] } }>(
                  'feishu_sheet.create',
                  (sdk: any, opts: any) =>
                    sdk.sheets.spreadsheetSheet.query({ path: { spreadsheet_token: token } }, opts),
                  { as: 'user' }
                );
                assertLarkOk(sheetsRes);
                const firstSheet = (sheetsRes.data?.sheets ?? [])[0];
                if (firstSheet?.sheet_id) {
                  const sheetId = firstSheet.sheet_id;
                  const numRows = allRows.length;
                  const numCols = Math.max(...allRows.map((r) => r.length));
                  const range = `${sheetId}!A1:${colLetter(numCols)}${numRows}`;

                  logger.info(`[sheet] create: writing ${numRows} rows to ${range}`);

                  const writeRes = await client.invokeByPath<{ code?: number; msg?: string }>(
                    'feishu_sheet.create',
                    `/open-apis/sheets/v2/spreadsheets/${token}/values`,
                    {
                      method: 'PUT',
                      body: { valueRange: { range, values: allRows } },
                      as: 'user',
                    }
                  );

                  if (writeRes.code && writeRes.code !== 0) {
                    logger.info(`[sheet] create: initial data write failed: ${writeRes.msg}`);
                    return json({
                      spreadsheet_token: token,
                      url,
                      warning: `spreadsheet created but failed to write initial data: ${writeRes.msg}`,
                    });
                  }
                }
              }
            }

            return json({
              spreadsheet_token: token,
              title: p.title,
              url,
            });
          }

          // -----------------------------------------------------------------
          // EXPORT — 导出为 xlsx/csv
          // -----------------------------------------------------------------
          case 'export': {
            const { token } = await resolveToken(p, client, logger);

            if (p.file_extension === 'csv' && !p.sheet_id) {
              return json({
                error:
                  'sheet_id is required for CSV export (CSV can only export one worksheet at a time). Use info action to get the worksheet list.',
              });
            }

            if (!p.file_extension) {
              return json({ error: 'file_extension is required for export action' });
            }

            logger.info(
              `[sheet] export: token=${token}, format=${p.file_extension}, output=${p.output_path ?? '(info only)'}`
            );

            // Step 1: 创建导出任务
            const createRes = await client.invoke<{ data?: { ticket?: string } }>(
              'feishu_sheet.export',
              (sdk: any, opts: any) =>
                sdk.drive.exportTask.create(
                  {
                    data: {
                      file_extension: p.file_extension,
                      token,
                      type: 'sheet',
                      sub_id: p.sheet_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(createRes);

            const ticket = createRes.data?.ticket;
            if (!ticket) {
              return json({ error: 'failed to create export task: no ticket returned' });
            }

            logger.info(`[sheet] export: ticket=${ticket}`);

            // Step 2: 轮询等待完成
            let fileToken: string | undefined;
            let fileName: string | undefined;
            let fileSize: number | undefined;

            for (let i = 0; i < EXPORT_POLL_MAX_RETRIES; i++) {
              await sleep(EXPORT_POLL_INTERVAL_MS);

              const pollRes = await client.invoke<{ data?: { result?: { job_status?: number; file_token?: string; file_name?: string; file_size?: number; job_error_msg?: string } } }>(
                'feishu_sheet.export',
                (sdk: any, opts: any) =>
                  sdk.drive.exportTask.get({ path: { ticket }, params: { token } }, opts),
                { as: 'user' }
              );
              assertLarkOk(pollRes);

              const result = pollRes.data?.result;
              const jobStatus = result?.job_status;

              if (jobStatus === 0) {
                fileToken = result?.file_token;
                fileName = result?.file_name;
                fileSize = result?.file_size;
                logger.info(`[sheet] export: done, file_token=${fileToken}, size=${fileSize}`);
                break;
              }

              if (jobStatus !== undefined && jobStatus >= 3) {
                return json({ error: result?.job_error_msg || `export failed (status=${jobStatus})` });
              }

              logger.info(`[sheet] export: polling ${i + 1}/${EXPORT_POLL_MAX_RETRIES}, status=${jobStatus}`);
            }

            if (!fileToken) {
              return json({ error: 'export timeout: task did not complete within 30 seconds' });
            }

            // Step 3: 下载（如果指定了 output_path）
            if (p.output_path) {
              const dlRes: any = await client.invoke(
                'feishu_sheet.export',
                (sdk: any, opts: any) =>
                  sdk.drive.exportTask.download({ path: { file_token: fileToken! } }, opts),
                { as: 'user' }
              );

              const stream = dlRes.getReadableStream();
              const chunks: Buffer[] = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }

              await fs.mkdir(path.dirname(p.output_path), { recursive: true });
              await fs.writeFile(p.output_path, Buffer.concat(chunks));

              logger.info(`[sheet] export: saved to ${p.output_path}`);

              return json({
                file_path: p.output_path,
                file_name: fileName,
                file_size: fileSize,
              });
            }

            return json({
              file_token: fileToken,
              file_name: fileName,
              file_size: fileSize,
              hint: 'File exported. Provide output_path parameter to download locally.',
            });
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

        logger.error(`[sheet] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[sheets] Registered feishu_sheet tool');
}