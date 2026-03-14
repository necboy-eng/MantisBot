/**
 * 浏览器工具注册
 */

import type { Tool } from '../../types.js';
import { browserManager } from '../browser/types.js';
import * as browserOps from '../browser/operations.js';
import { getFileStorage } from '../../files/storage.js';

// 浏览器启动工具
export const browserLaunchTool: Tool = {
  name: 'browser_launch',
  description: '启动浏览器。必须在其他浏览器操作之前调用。可以选择无头模式或可视化模式。',
  parameters: {
    type: 'object',
    properties: {
      headless: {
        type: 'boolean',
        description: '是否使用无头模式（不显示浏览器窗口）',
        default: false
      },
      slowMo: {
        type: 'number',
        description: '操作减慢时间（毫秒），用于调试'
      },
      timeout: {
        type: 'number',
        description: '启动超时时间（毫秒）',
        default: 30000
      }
    },
    required: []
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      await browserManager.launch({
        headless: params.headless as boolean | undefined,
        slowMo: params.slowMo as number | undefined,
        timeout: params.timeout as number | undefined,
      });

      return {
        success: true,
        message: '浏览器已启动',
        isHeadless: params.headless ?? false,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }
};

// 浏览器关闭工具
export const browserCloseTool: Tool = {
  name: 'browser_close',
  description: '关闭浏览器并释放资源',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (): Promise<unknown> => {
    try {
      await browserManager.close();
      return { success: true, message: '浏览器已关闭' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 导航工具
export const browserNavigateTool: Tool = {
  name: 'browser_navigate',
  description: '导航到指定URL。此工具会自动等待页面加载完成（DOM Content Loaded），无需额外的等待操作。提示：导航完成后必须执行以下步骤：1) 调用 browser_snapshot 获取页面内容；2) 【必须】调用 browser_screenshot 截取页面截图，向用户展示页面外观。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要访问的URL'
      }
    },
    required: ['url']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      const result = await browserOps.browserNavigate(params.url as string);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 点击工具
export const browserClickTool: Tool = {
  name: 'browser_click',
  description: '点击页面元素。此工具会自动等待元素可点击，无需额外的等待操作。',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS选择器或XPath'
      }
    },
    required: ['selector']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      await browserOps.browserClick(params.selector as string);
      return { success: true, message: '点击成功' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 输入文本工具
export const browserTypeTool: Tool = {
  name: 'browser_type',
  description: '在输入框中输入文本',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS选择器'
      },
      text: {
        type: 'string',
        description: '要输入的文本'
      },
      pressEnter: {
        type: 'boolean',
        description: '输入后是否按Enter键',
        default: false
      }
    },
    required: ['selector', 'text']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      await browserOps.browserType(
        params.selector as string,
        params.text as string,
        params.pressEnter as boolean | undefined
      );
      return { success: true, message: '输入成功' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 获取快照工具
export const browserSnapshotTool: Tool = {
  name: 'browser_snapshot',
  description: '获取当前页面的快照，包括URL、标题和文本内容。这是获取页面内容的主要工具。重要：1) 需要了解页面内容时必须调用此工具；2) 此工具返回页面的文本信息��用于回答用户问题；3) 【重要】调用此工具后，必须继续调用 browser_screenshot 工具向用户展示页面外观，让用户直观看到页面；4) 不要只调用 snapshot 而不调用 screenshot。',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (): Promise<unknown> => {
    try {
      const result = await browserOps.browserSnapshot();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 截图工具
export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description: '截取当前页面的屏幕截图。【重要】这是浏览器操作中的必需步骤！当用户请求浏览网页时，必须在获取页面内容后调用此工具向用户展示页面外观。使用场景：1) 在 browser_navigate 或 browser_snapshot 之后，必须调用此工具展示页面；2) 执行搜索、点击等操作后，应该调用此工具展示结果页面；3) 截图会自动显示在前端界面的浏览器标签中，提供可视化反馈。',
  parameters: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description: '是否截取完整页面（包括滚动区域）',
        default: false
      }
    },
    required: []
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      console.log('[BrowserScreenshot] Starting screenshot, fullPage:', params.fullPage);  // 调试日志

      // 获取页面信息（URL和title）
      const snapshot = await browserOps.browserSnapshot();

      // 截图
      const base64 = await browserOps.browserScreenshot(params.fullPage as boolean | undefined);
      console.log('[BrowserScreenshot] Screenshot success, size:', base64.length);  // 调试日志

      // 保存截图到文件
      const timestamp = Date.now();
      const filename = `screenshot-${timestamp}.png`;
      const fileStorage = getFileStorage();
      const savedFile = fileStorage.saveImageFile(filename, base64, 'image/png');
      console.log('[BrowserScreenshot] Saved to:', savedFile.url);

      return {
        success: true,
        message: '截图成功',
        image: base64,  // 保留 base64 用于 LLM 理解（会被截断）
        mimeType: 'image/png',
        url: snapshot.url,      // 页面 URL
        title: snapshot.title,  // 页面 title
        savedImagePath: savedFile.url,  // 保存的文件路径（用于前端显示）
        savedImageName: savedFile.name
      };
    } catch (error) {
      console.error('[BrowserScreenshot] Screenshot failed:', error);  // 调试日志
      return { success: false, error: String(error) };
    }
  }
};

// 等待元素工具
export const browserWaitTool: Tool = {
  name: 'browser_wait',
  description: '等待指定元素出现。注意：大多数情况下不需要此工具，因为 navigate、click 等工具已自动等待。仅在特殊情况下使用，例如等待动态加载的内容。',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS选择器'
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），建议使用较短的超时时间如 5000',
        default: 5000
      }
    },
    required: ['selector']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      await browserOps.browserWait(
        params.selector as string,
        params.timeout as number | undefined
      );
      return { success: true, message: '元素已出现' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 等待时间工具
export const browserWaitForTool: Tool = {
  name: 'browser_wait_for',
  description: '等待指定时间（毫秒）。注意：应该尽量减少使用此工具，仅在确实需要等待时使用，建议等待时间不超过 1000 毫秒。',
  parameters: {
    type: 'object',
    properties: {
      time: {
        type: 'number',
        description: '等待时间（毫秒），建议不超过 1000'
      }
    },
    required: ['time']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      await browserOps.browserWaitFor(params.time as number);
      return { success: true, message: '等待完成' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 获取元素文本工具
export const browserGetTextTool: Tool = {
  name: 'browser_get_text',
  description: '获取指定元素的文本内容',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS选择器'
      }
    },
    required: ['selector']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      const text = await browserOps.browserGetText(params.selector as string);
      return { success: true, text };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 检查元素存在工具
export const browserExistsTool: Tool = {
  name: 'browser_exists',
  description: '检查指定元素是否存在',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS选择器'
      }
    },
    required: ['selector']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      const exists = await browserOps.browserExists(params.selector as string);
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 刷新页面工具
export const browserRefreshTool: Tool = {
  name: 'browser_refresh',
  description: '刷新当前页面',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (): Promise<unknown> => {
    try {
      await browserOps.browserRefresh();
      return { success: true, message: '页面已刷新' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 返回上一页工具
export const browserGoBackTool: Tool = {
  name: 'browser_go_back',
  description: '返回上一页',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (): Promise<unknown> => {
    try {
      await browserOps.browserGoBack();
      return { success: true, message: '已返回上一页' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 获取HTML工具
export const browserGetHTMLTool: Tool = {
  name: 'browser_get_html',
  description: '获取当前页面的完整HTML',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (): Promise<unknown> => {
    try {
      const html = await browserOps.browserGetHTML();
      return { success: true, html };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 执行JavaScript工具
export const browserEvaluateTool: Tool = {
  name: 'browser_evaluate',
  description: '在页面中执行JavaScript代码',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的JavaScript代码'
      }
    },
    required: ['code']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    try {
      const result = await browserOps.browserEvaluate(params.code as string);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

// 所有浏览器工具
export const browserTools: Tool[] = [
  browserLaunchTool,
  browserCloseTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserSnapshotTool,
  browserScreenshotTool,
  browserWaitTool,
  browserWaitForTool,
  browserGetTextTool,
  browserExistsTool,
  browserRefreshTool,
  browserGoBackTool,
  browserGetHTMLTool,
  browserEvaluateTool,
];
