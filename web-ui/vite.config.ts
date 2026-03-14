import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 版本号解析策略（优先级从高到低）：
// 1. Docker 构建时通过 --build-arg VERSION=x.x.x 注入的环境变量
// 2. npm 运行时自动注入的 npm_package_version（本地 web-ui/package.json 版本）
// 3. 尝试读取上级目录的 package.json（本地开发时 MantisBot 根目录）
// 4. 兜底值 '0.0.0'
function resolveVersion(): string {
  if (process.env.VERSION) return process.env.VERSION;
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
    return rootPkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const APP_VERSION: string = resolveVersion();

// Vite 在 configure 之后才注册自己的 proxy.on('error', ...) 处理器
// 所以无法用 removeAllListeners 提前移除——需要在 configure 中替换 proxy.on，
// 让 Vite 注册的处理器在执行前先过滤掉后端重启时的瞬态连接错误
const TRANSIENT_PROXY_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET']);

function suppressTransientProxyErrors() {
  return {
    configure: (proxy: any) => {
      const _on = proxy.on.bind(proxy);
      proxy.on = (event: string, handler: (...args: any[]) => void) => {
        if (event === 'error') {
          return _on(event, (err: NodeJS.ErrnoException, ...rest: any[]) => {
            if (TRANSIENT_PROXY_ERRORS.has(err.code ?? '')) return; // 后端启动/重启中，静默忽略
            handler(err, ...rest);
          });
        }
        return _on(event, handler);
      };
    }
  };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8118',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
        ...suppressTransientProxyErrors()
      },
      '/auth': {
        target: 'http://localhost:8118',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
        ...suppressTransientProxyErrors()
      },
      '/health': {
        target: 'http://localhost:8118',
        changeOrigin: true,
        ...suppressTransientProxyErrors()
      },
      '/ws': {
        target: 'ws://localhost:8118',
        ws: true,
        ...suppressTransientProxyErrors()
      },
      '/office-preview': {
        target: 'http://localhost:8118',
        changeOrigin: true,
        ...suppressTransientProxyErrors()
      }
    }
  }
});
