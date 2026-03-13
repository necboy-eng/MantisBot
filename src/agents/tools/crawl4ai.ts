import type { Tool } from '../../types.js';
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const CRAWL4AI_SCRIPT = `
import asyncio
import sys
import json
import os
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

async def crawl(params):
    action = params.get('action', 'scrape')
    browser_config = BrowserConfig(
        headless=True,
        viewport_width=1920,
        viewport_height=1080,
        verbose=False
    )
    if action == 'scrape':
        url = params['url']
        css_selector = params.get('cssSelector')
        excluded_tags = params.get('excludedTags', [])
        crawler_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            remove_overlay_elements=True,
            page_timeout=params.get('timeout', 30000),
            css_selector=css_selector,
            excluded_tags=excluded_tags,
            verbose=False,
        )
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=crawler_config)
            if result.success:
                # 截断 markdown 避免过长（SDK 会把长文本当附件）
                markdown_content = result.markdown[:8000] if result.markdown else ''
                # 限制 links 数量，避免 SDK 把大量 URL 当附件
                links_internal = result.links.get('internal', [])[:5]
                links_external = result.links.get('external', [])[:5]
                output = {
                    'success': True,
                    'url': result.url,
                    'title': result.metadata.get('title', ''),
                    'description': result.metadata.get('description', ''),
                    'markdown': markdown_content,
                    'links': {
                        'internal': links_internal,
                        'external': links_external,
                    },
                    'images_count': len(result.media.get('images', [])),
                }
            else:
                output = {'success': False, 'error': result.error_message}
        print(json.dumps(output, ensure_ascii=False))
    elif action == 'batch':
        urls = params['urls']
        max_concurrent = params.get('maxConcurrent', 5)
        crawler_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            remove_overlay_elements=True,
            page_timeout=params.get('timeout', 30000),
            verbose=False,
        )
        async with AsyncWebCrawler(config=browser_config) as crawler:
            results = await crawler.arun_many(
                urls=urls,
                config=crawler_config,
                max_concurrent=max_concurrent
            )
        output = []
        for r in results:
            if r.success:
                # 批量时截断避免过大（SDK 会把长文本当附件）
                markdown_content = r.markdown[:2000] if r.markdown else ''
                output.append({
                    'success': True,
                    'url': r.url,
                    'title': r.metadata.get('title', ''),
                    'markdown': markdown_content,
                    'content_length': len(r.markdown) if r.markdown else 0,
                })
            else:
                output.append({'success': False, 'url': r.url, 'error': r.error_message})
        print(json.dumps(output, ensure_ascii=False))
if __name__ == '__main__':
    params = json.loads(sys.argv[1])
    asyncio.run(crawl(params))
`;

/**
 * Crawl4AI 工具 - 基于 Playwright 的高质量网页爬取
 * 专注于网页内容抓取，不提供搜索功能
 * 支持 JS 渲染、动态内容、批量爬取，输出干净的 Markdown
 *
 * 注意：此工具不提供搜索功能，请使用 firecrawl 工具进行网页搜索
 */
export const crawl4aiTool: Tool = {
  name: 'crawl4ai',
  description: '【推荐】使用 Crawl4AI 爬取网页内容，支持 JavaScript 渲染，输出高质量 Markdown。适用于：动态页面、新闻文章、批量多 URL 爬取。 注意：此工具不提供搜索功能，请使用 firecrawl 工具进行网页搜索。\n\n**使用示例**:\n```json\n{"action": "scrape", "url": "https://example.com"}\n{"action": "batch", "urls": ["https://a.com", "https://b.com"]}\n```',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['scrape', 'batch'],
        description: '操作类型：scrape（单页爬取，默认）或 batch（批量多页爬取）'
      },
      url: {
        type: 'string',
        description: '要爬取的 URL（action=scrape 时必填）'
      },
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: '要批量爬取的 URL 列表（action=batch 时必填）'
      },
      cssSelector: {
        type: 'string',
        description: '只提取指定 CSS 选择器内的内容（可选），例如 ".main-content"'
      },
      excludedTags: {
        type: 'array',
        items: { type: 'string' },
        description: '要排除的 HTML 标签列表，例如 ["nav", "footer", "aside"]'
      },
      maxConcurrent: {
        type: 'number',
        description: '批量爬取时的最大并发数（默认 5）'
      },
      timeout: {
        type: 'number',
        description: '页面加载超时时间（毫秒，默认 30000）'
      }
    },
    required: ['action']
  },

  execute: async (params: Record<string, unknown>) => {
    // 参数验证和默认值处理
    const action = (params.action as string) || 'scrape';

    // 验证 action
    if (action !== 'scrape' && action !== 'batch') {
      return {
        success: false,
        error: `Invalid action: "${action}". Must be "scrape" or "batch".`,
        hint: '使用示例: {"action": "scrape", "url": "https://example.com"} 或 {"action": "batch", "urls": ["https://a.com", "https://b.com"]}'
      };
    }

    if (action === 'scrape' && !params.url) {
      return {
        success: false,
        error: 'Missing required parameter: url (required when action=scrape)'
      };
    }

    if (action === 'batch' && !params.urls) {
      return {
        success: false,
        error: 'Missing required parameter: urls (required when action=batch)'
      };
    }

    // 清理参数：处理空字符串和无效值
    const cleanedParams = {
      action,
      url: params.url || null,
      urls: params.urls || null,
      // 空字符串转为 null，避免传给 Python 时出错
      cssSelector: params.cssSelector === '' || params.cssSelector === '""' ? null : (params.cssSelector || null),
      excludedTags: Array.isArray(params.excludedTags) ? params.excludedTags : [],
      maxConcurrent: typeof params.maxConcurrent === 'number' ? params.maxConcurrent : 5,
      timeout: typeof params.timeout === 'number' ? params.timeout : 30000
    };

    const cwd = process.cwd();
    const tmpDir = path.join(cwd, '.crawl4ai-tmp');

    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true });
    }

    const scriptPath = path.join(tmpDir, `crawl4ai_runner_${Date.now()}.py`);
    await writeFile(scriptPath, CRAWL4AI_SCRIPT, 'utf-8');

    return new Promise((resolve, reject) => {
      const paramsJson = JSON.stringify(cleanedParams);

      console.log(`[Crawl4AI] action=${action}, url=${params.url || (params.urls as string[])?.join(',')}`);

      // 使用系统 Python，因为 crawl4ai 在 Docker 中是安装到系统 Python 的
      // 注意：entrypoint.sh 会激活虚拟环境，但 crawl4ai 安装在系统 Python
      // 所以必须显式指定 /usr/bin/python3，避免使用 venv 中的 python
      const child = spawn('/usr/bin/python3', [scriptPath, paramsJson], {
        cwd,
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: '/app/.playwright-python'
        },
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', async (code) => {
        // 清理临时脚本
        try {
          const { unlink } = await import('fs/promises');
          await unlink(scriptPath);
        } catch { /* ignore */ }

        console.log(`[Crawl4AI] Exit code: ${code}, stdout length: ${stdout.length}, stderr: ${stderr.slice(-200)}`);

        if (code !== 0) {
          console.error(`[Crawl4AI] Error (exit ${code}): ${stderr}`);
          resolve({
            success: false,
            error: `crawl4ai exited with code ${code}`,
            details: stderr.slice(-500)
          });
          return;
        }

        // 如果 stdout 为空，返回错误
        if (!stdout.trim()) {
          console.error(`[Crawl4AI] No output from script. stderr: ${stderr.slice(-500)}`);
          resolve({
            success: false,
            error: 'No output from crawl4ai script',
            details: stderr.slice(-500)
          });
          return;
        }

        try {
          const output = JSON.parse(stdout.trim());
          resolve(output);
        } catch {
          // JSON 解析失败，返回原始输出
          resolve({ success: false, error: 'Failed to parse crawl4ai output', raw: stdout.slice(0, 1000) });
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start crawl4ai: ${err.message}. Make sure crawl4ai is installed: pip install crawl4ai`));
      });
    });
  }
};
