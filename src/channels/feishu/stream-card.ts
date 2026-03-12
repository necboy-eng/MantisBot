// src/channels/feishu/stream-card.ts

import * as lark from '@larksuiteoapi/node-sdk';

export interface StreamCardOptions {
  chatId: string;
  title?: string;
  userId?: string;
}

/**
 * 飞书流式卡片管理器
 * 使用 interactive card 实现流式更新
 *
 * 参考：~/.openclaw/extensions/feishu-openclaw-plugin/src/messaging/outbound/send.js
 */
export class FeishuStreamCard {
  private client: lark.Client;
  private messageId: string | null = null;
  private chatId: string;
  private title?: string;
  private userId?: string;
  private buffer: string = '';
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 500; // 500ms 更新一次（更快流式体验）
  private readonly MAX_CONTENT_LENGTH = 15000; // 最大内容长度（避免超出限制）
  private readonly MAX_TABLE_COUNT = 5; // 飞书卡片表格数量限制，超过此数量转换为列表

  constructor(options: StreamCardOptions, client: lark.Client) {
    this.chatId = options.chatId;
    this.title = options.title;
    this.userId = options.userId;
    this.client = client;
  }

  /**
   * 优化 Markdown 样式（参考 OpenClaw 的 optimizeMarkdownStyle）
   * - 标题降级：H1 → H4，H2~H6 → H5
   * - 表格前后增加 <br> 标签（cardVersion >= 2）
   */
  private optimizeMarkdownStyle(text: string, cardVersion: number = 2): string {
    try {
      let r = text;

      console.log(`[StreamCard] optimizeMarkdownStyle called, cardVersion=${cardVersion}`);
      console.log(`[StreamCard] Original text length: ${text.length}, first 200 chars: ${text.substring(0, 200)}`);

      // 1. 提取代码块，用占位符保护，处理后再还原
      const MARK = '___CB_';
      const codeBlocks: string[] = [];

      // 测试正则是否能匹配
      const testMatch = text.match(/```[\s\S]*?```/g);
      console.log(`[StreamCard] Regex test - found ${testMatch?.length || 0} code blocks`);
      if (testMatch) {
        console.log(`[StreamCard] Test matches:`, testMatch.map(m => m.substring(0, 30)));
      }

      r = r.replace(/```[\s\S]*?```/g, (m) => {
        codeBlocks.push(m);  // 保存代码块内容
        console.log(`[StreamCard] Found code block ${codeBlocks.length}: ${m.substring(0, 50)}...`);
        return `${MARK}${codeBlocks.length - 1}___`;  // 使用当前索引
      });

      console.log(`[StreamCard] Code blocks found: ${codeBlocks.length}, text after placeholder: ${r.substring(0, 100)}...`);

      // 2. 标题降级
      const hasH1toH3 = /^#{1,3} /m.test(text);
      if (hasH1toH3) {
        r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2~H6 → H5
        r = r.replace(/^# (.+)$/gm, '#### $1'); // H1 → H4
      }

      if (cardVersion >= 2) {
        // 3. 连续标题间增加段落间距
        r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

        // 4. 表格前后增加 <br> 标签
        // 4a. 非表格行直接跟表格行时，先补一个空行
        r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
        // 4b. 表格前：在空行之前插入 <br>
        r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
        // 4c. 表格后：在表格块末尾追加 <br>
        r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');

        // 5. 还原代码块
        // 飞书 Markdown 不支持 ``` 代码块，转换为普通文本显示
        console.log(`[StreamCard] Restoring ${codeBlocks.length} code blocks...`);
        codeBlocks.forEach((block, i) => {
          const placeholder = `${MARK}${i}___`;

          // 提取代码内容
          let codeContent = block
            .replace(/^```\w*\n?/, '')  // 去掉开头的 ```
            .replace(/```$/, '')        // 去掉结尾的 ```

          // 用 <code> 标签或纯文本方式显示
          const beforeReplace = r;
          r = r.replace(placeholder, `\n\n【代码】\n${codeContent}\n【代码结束】\n\n`);
          if (r === beforeReplace) {
            console.log(`[StreamCard] WARNING: Placeholder ${placeholder} not found in text!`);
          } else {
            console.log(`[StreamCard] Restored code block ${i}: ${codeContent.substring(0, 30)}...`);
          }
        });
      } else {
        // 还原代码块（无 <br>）
        codeBlocks.forEach((block, i) => {
          r = r.replace(`${MARK}${i}___`, block);
        });
      }

      // 6. 压缩多余空行
      r = r.replace(/\n{3,}/g, '\n\n');

      return r;
    } catch {
      return text;
    }
  }

  /**
   * 计算 Markdown 内容中的表格数量
   */
  private countTables(text: string): number {
    const tableRegex = /^\|.+\|\s*$/gm;
    const matches = text.match(tableRegex);
    if (!matches) return 0;

    // 计算连续表格块的数量
    let tableCount = 0;
    let inTable = false;
    const lines = text.split('\n');

    for (const line of lines) {
      const isTableRow = /^\|.+\|\s*$/.test(line);
      const isSeparator = /^\|[\s:\-|]+\|\s*$/.test(line);

      if (isTableRow && !isSeparator) {
        if (!inTable) {
          tableCount++;
          inTable = true;
        }
      } else if (!isTableRow && !isSeparator) {
        inTable = false;
      }
    }

    return tableCount;
  }

  /**
   * 解析单个 Markdown 表格
   */
  private parseMarkdownTable(tableText: string): { headers: string[]; rows: string[][] } | null {
    const lines = tableText.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) return null;

    const headerLine = lines[0];
    const headers = headerLine
      .split('|')
      .map(h => h.trim())
      .filter((h, i, arr) => {
        if (i === 0 && h === '') return false;
        if (i === arr.length - 1 && h === '') return false;
        return true;
      });

    const rows: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
      if (/^[\s:\-|]+$/.test(lines[i])) continue; // 跳过分隔线

      const cells = lines[i]
        .split('|')
        .map(c => c.trim())
        .filter((c, j, arr) => {
          if (j === 0 && c === '') return false;
          if (j === arr.length - 1 && c === '') return false;
          return true;
        });

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    return { headers, rows };
  }

  /**
   * 将单个表格转换为列表格式
   */
  private convertTableToList(headers: string[], rows: string[][]): string {
    if (headers.length === 0 || rows.length === 0) return '';

    const lines: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.map((cell, j) => {
        const header = headers[j] || '';
        if (cell.trim()) {
          return header ? `**${header}**: ${cell}` : cell;
        }
        return '';
      }).filter(c => c);

      if (cells.length > 0) {
        lines.push(`${i + 1}. ${cells.join(' | ')}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 将超过限制的表格转换为列表格式
   */
  private convertExcessTablesToList(text: string): string {
    const tableCount = this.countTables(text);

    if (tableCount <= this.MAX_TABLE_COUNT) {
      console.log(`[FeishuStreamCard] Table count: ${tableCount}, within limit`);
      return text;
    }

    console.log(`[FeishuStreamCard] Table count: ${tableCount}, exceeds limit ${this.MAX_TABLE_COUNT}, converting to list`);

    const lines = text.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 检查是否是表格开始
      if (/^\|.+\|\s*$/.test(line) && !/^[\s:\-|]+$/.test(line)) {
        // 收集整个表格块
        const tableLines: string[] = [];
        let j = i;

        while (j < lines.length && /^\|.+\|\s*$/.test(lines[j])) {
          tableLines.push(lines[j]);
          j++;
        }

        // 解析并转换为列表
        const tableText = tableLines.join('\n');
        const parsed = this.parseMarkdownTable(tableText);

        if (parsed && parsed.headers.length > 0 && parsed.rows.length > 0) {
          const converted = this.convertTableToList(parsed.headers, parsed.rows);
          result.push(converted);
        } else {
          result.push(tableText);
        }

        i = j;
      } else {
        result.push(line);
        i++;
      }
    }

    return result.join('\n');
  }

  /**
   * 构建卡片内容（参考 OpenClaw 的 buildMarkdownCard）
   */
  private buildCardContent(markdown: string): any {
    // 先检查表格数量，超过限制时转换为列表格式
    const contentWithConvertedTables = this.convertExcessTablesToList(markdown);
    // 使用 cardVersion = 2 启用表格 <br> 标签
    const optimizedText = this.optimizeMarkdownStyle(contentWithConvertedTables, 2);

    return {
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: optimizedText,
          },
        ],
      },
    };
  }

  /**
   * 初始化：创建"思考中"卡片
   */
  async initialize(): Promise<void> {
    const config = await this.getConfig();

    const showThinking = config?.streaming?.showThinking ?? true;
    const initialMarkdown = showThinking ? '🤔 思考中...' : '';

    // 使用 interactive card
    const cardContent = this.buildCardContent(initialMarkdown);

    const result = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: this.chatId,
        content: JSON.stringify(cardContent),
        msg_type: 'interactive',
      },
    });

    if (result.code !== 0 || !result.data?.message_id) {
      throw new Error(`创建流式卡片失败: ${result.msg}`);
    }

    this.messageId = result.data.message_id;
    console.log(`[FeishuStreamCard] Card created: ${this.messageId}`);
  }

  /**
   * 追加文本到缓冲区
   */
  async append(text: string): Promise<void> {
    this.buffer += text;

    // 截断过长的内容
    if (this.buffer.length > this.MAX_CONTENT_LENGTH) {
      this.buffer = this.buffer.slice(0, this.MAX_CONTENT_LENGTH) + '\n\n... [内容过长已截断]';
    }

    const now = Date.now();

    console.log(`[FeishuStreamCard] Appended ${text.length} chars, buffer length: ${this.buffer.length}, time since last update: ${now - this.lastUpdateTime}ms`);

    // 节流：避免过于频繁的更新调用
    if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      console.log(`[FeishuStreamCard] Updating card...`);
      await this.updateCard();
      this.lastUpdateTime = now;
    }
  }

  /**
   * 完成：最终更新
   */
  async complete(): Promise<void> {
    // 确保最后一次更新
    console.log(`[FeishuStreamCard] Complete, final buffer length: ${this.buffer.length}`);
    await this.updateCard();
    console.log(`[FeishuStreamCard] Card completed: ${this.messageId}`);
  }

  /**
   * 更新卡片内容
   * 使用 im.message.patch API（参考 OpenClaw 的 updateCardFeishu）
   */
  private async updateCard(): Promise<void> {
    if (!this.messageId) return;

    const markdown = this.buffer || '';

    // 移除"思考中"标记
    const cleanMarkdown = markdown.replace(/^🤔 思考中\.{2,3}/, '').trim();

    const cardContent = this.buildCardContent(cleanMarkdown);

    try {
      // 使用 patch API 更新卡片
      const result = await this.client.im.v1.message.patch({
        path: { message_id: this.messageId },
        data: {
          content: JSON.stringify(cardContent),
        },
      });

      if (result.code !== 0) {
        console.error(`[FeishuStreamCard] Card update failed: ${result.msg}`);
      } else {
        console.log(`[FeishuStreamCard] Card updated successfully, content length: ${cleanMarkdown.length}`);
      }
    } catch (error: any) {
      console.error('[FeishuStreamCard] Card update error:', error.message || error);
    }
  }

  /**
   * 获取飞书配置
   */
  private async getConfig(): Promise<any> {
    const { getConfig } = await import('../../config/loader.js');
    const config = getConfig();
    return (config.channels as any)?.feishu;
  }

  /**
   * 获取消息 ID
   */
  getMessageId(): string | null {
    return this.messageId;
  }

  /**
   * 清空缓冲区（用于重新开始）
   */
  clearBuffer(): void {
    this.buffer = '';
    this.lastUpdateTime = 0;
  }
}
