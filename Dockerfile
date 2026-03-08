FROM node:22-bookworm

WORKDIR /app

# 安装编译 native 模块所需的依赖，以及完整的 Python 环境
# 同时安装 Playwright Chromium 所需的系统依赖和中文字体
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  make \
  g++ \
  # Playwright Chromium 依赖
  libnspr4 \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libdbus-1-3 \
  libcups2 \
  libxkbcommon0 \
  libatspi2.0-0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2 \
  # 中文字体支持（用于 Playwright 截图）
  fonts-wqy-zenhei \
  fonts-wqy-microhei \
  fonts-noto-cjk \
  # PDF 文本提取工具
  poppler-utils \
  # 文档格式转换工具（docx skill 使用）
  pandoc \
  && rm -rf /var/lib/apt/lists/*

# 创建 Python 虚拟环境目录（用于持久化用户安装的包）
RUN mkdir -p /app/python-venv

# 配置 pip 全局使用清华镜像（加速国内下载）
RUN mkdir -p /etc/pip && \
    echo "[global]" > /etc/pip/pip.conf && \
    echo "index-url = https://pypi.tuna.tsinghua.edu.cn/simple" >> /etc/pip/pip.conf && \
    echo "trusted-host = pypi.tuna.tsinghua.edu.cn" >> /etc/pip/pip.conf

# 配置 npm 全局使用淘宝镜像（加速国内下载）
RUN npm config set registry https://registry.npmmirror.com

# 复制启动脚本
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 复制源码（需要在 rebuild 之前，因为某些 native 模块依赖源码）
COPY . .

# 安装依赖（包括 devDependencies，因为需要 tsc）
# 使用 --legacy-peer-deps 解决 zod 版本冲突（openai 需要 zod@3，但项目使用 zod@4）
# PUPPETEER_SKIP_DOWNLOAD=true 跳过 puppeteer 的浏览器下载（项目使用 Playwright，无需 puppeteer 的浏览器）
# SKIP_WEB_UI_INSTALL=true 跳过 postinstall 自动安装 web-ui 依赖（web-ui 在独立容器中构建）
RUN PUPPETEER_SKIP_DOWNLOAD=true SKIP_WEB_UI_INSTALL=true npm ci --legacy-peer-deps

# 编译 TypeScript
RUN npm run build

# 预装 Playwright Chromium（打包进镜像，避免服务器启动时下载）
# 将浏览器安装到 /app/.playwright，避免被 ~/:/root 卷挂载覆盖
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install chromium

# 安装 Firecrawl CLI
RUN npm install -g firecrawl-cli

# 全局安装 pptxgenjs（skill 脚本在动态工作目录中执行，无法访问 /app/node_modules）
RUN npm install -g pptxgenjs

# 安装 crawl4ai 及其 Playwright 浏览器驱动
# 使用系统 pip（不在 venv 中），确保 crawl4ai 命令全局可用
# 注意：crawl4ai 内部的 Python playwright 与 Node.js playwright 版本不同，不能共用浏览器文件
# 用独立路径 /app/.playwright-python 隔离，避免与 /app/.playwright（Node.js）冲突
# 增加 --timeout 参数避免网络超时
# 先安装 pydantic 等依赖，再安装 playwright，最后安装 crawl4ai
RUN pip3 install --no-cache-dir --break-system-packages --timeout 600 pydantic && \
    pip3 install --no-cache-dir --break-system-packages --timeout 600 playwright>=1.49.0 && \
    pip3 install --no-cache-dir --break-system-packages --timeout 600 crawl4ai && \
    PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-python crawl4ai-setup

# 备份内置 skills，供首次启动时初始化持久化卷
RUN cp -r /app/skills /app/skills-default

# 备份默认人格文件，供首次启动时初始化
RUN cp -r /app/data/agent-profiles /app/agent-profiles-default

# 暴露端口
EXPOSE 8118

# 启动命令（使用 bash 执行脚本）
CMD ["bash", "/app/docker-entrypoint.sh"]
