/**
 * 飞书表格转换器
 * 将标准 Markdown 表格转换为飞书卡片支持的格式
 */

/**
 * 解析单个 Markdown 表格（支持有无分隔线两种格式）
 */
function parseMarkdownTable(tableText: string): { headers: string[]; rows: string[][] } | null {
  const lines = tableText.trim().split('\n').filter(line => line.trim());

  if (lines.length < 2) return null;

  let headerIndex = 0;
  // 检查第二行是否是分隔线
  if (lines.length >= 2 && /^[\s:\-|]+$/.test(lines[1])) {
    headerIndex = 0;
  }

  const headerLine = lines[headerIndex];
  const headers = headerLine
    .split('|')
    .map(h => h.trim())
    .filter((h, i, arr) => {
      if (i === 0 && h === '') return false;
      if (i === arr.length - 1 && h === '') return false;
      return h !== '';
    });

  // 从分隔线后开始解析数据行
  const dataStartIndex = headerIndex + 1;
  const rows: string[][] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    // 跳过分隔线
    if (/^[\s:\-|]+$/.test(lines[i])) continue;

    const cells = lines[i]
      .split('|')
      .map(c => c.trim())
      .filter((c, j, arr) => {
        if (j === 0 && c === '') return false;
        if (j === arr.length - 1 && c === '') return false;
        return c !== '';
      });

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

/**
 * 将单个表格转换为飞书友好的列表格式
 * 飞书卡片的 markdown 元素对标准表格支持有限，使用列表格式更可靠
 */
function convertSingleTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0 || rows.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // 每行数据转换为列表项
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // 将每列数据以 "表头: 内容" 的格式呈现
    const cells = row.map((cell, j) => {
      const header = headers[j] || '';
      // 如果单元格有内容，显示为 "表头: 内容" 格式
      if (cell.trim()) {
        return header ? `**${header}**: ${cell}` : cell;
      }
      return '';
    }).filter(c => c);

    if (cells.length > 0) {
      // 使用数字列表
      lines.push(`${i + 1}. ${cells.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * 按行处理内容，查找并转换表格
 */
function processLines(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // 检查是否可能是表格的开始（以 | 开头）
    if (lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
      // 收集可能的表格行
      const tableLines: string[] = [];
      let j = i;

      while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
        tableLines.push(lines[j]);
        j++;
      }

      // 检查是否包含分隔线行
      const hasSeparator = tableLines.some(line => /^[\s:\-|]+$/.test(line.trim()));

      if (hasSeparator || tableLines.length >= 3) {
        // 尝试解析为表格
        const tableText = tableLines.join('\n');
        const parsed = parseMarkdownTable(tableText);

        if (parsed && parsed.headers.length > 0 && parsed.rows.length > 0) {
          // 转换表格为列表格式（适配飞书 markdown）
          const converted = convertSingleTable(parsed.headers, parsed.rows);
          console.log('[TableConverter] Converted table to list format:', parsed.rows.length, 'rows,', parsed.headers.length, 'columns');
          result.push(converted);
          i = j;
          continue;
        }
      }

      // 不是有效表格，保留原始行
      result.push(lines[i]);
      i++;
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result;
}

/**
 * 将标准 Markdown 表格转换为飞书支持的格式
 */
export function convertMarkdownTableToFeishu(content: string): string {
  console.log('[TableConverter] Input length:', content.length);

  // 按行处理
  const lines = content.split('\n');
  const processedLines = processLines(lines);
  const result = processedLines.join('\n');

  console.log('[TableConverter] Output length:', result.length);
  return result;
}

/**
 * 构建消息卡片（支持 Markdown 格式）
 */
export function buildMarkdownCard(content: string, title?: string): string {
  const processedContent = convertMarkdownTableToFeishu(content);

  const card: any = {
    config: {
      wide_screen_mode: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: processedContent,
      },
    ],
  };

  if (title) {
    card.header = {
      title: {
        tag: 'plain_text',
        content: title,
      },
      template: 'blue',
    };
  }

  console.log('[FeishuCard] Content length:', processedContent.length);
  return JSON.stringify(card);
}
