FROM node:22-bookworm

WORKDIR /app

# 配置环境变量
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    SKIP_WEB_UI_INSTALL=true \
    PLAYWRIGHT_BROWSERS_PATH=/app/.playwright \
    PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

# 1. 安装系统依赖（root 执行）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    python3 python3-pip python3-venv make g++ \
    libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libdbus-1-3 \
    libcups2 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 \
    fonts-wqy-zenhei fonts-wqy-microhei fonts-noto-cjk \
    poppler-utils pandoc curl \
    && rm -rf /var/lib/apt/lists/*

# 2. 配置镜像
RUN mkdir -p /etc/pip && \
    echo "[global]\nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple\ntrusted-host = pypi.tuna.tsinghua.edu.cn" > /etc/pip/pip.conf && \
    npm config set registry https://registry.npmmirror.com

# 3. 创建必要的目录并预设权限
RUN mkdir -p /app/data /app/skills /app/config /app/python-venv /app/.playwright /app/.playwright-python \
             /app/data/claude-sdk && \
    chown -R node:node /app

# 4. 复制依赖文件和安装脚本
COPY --chown=node:node package*.json ./
COPY --chown=node:node scripts/ scripts/

# 切换到非 root 用户
USER node

# 5. 安装 NPM 依赖（显式指定缓存目录权限）
# 包含 devDependencies 以便后续构建 (tsc)
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --legacy-peer-deps --include=dev

# 6. 预装 Playwright Chromium
RUN for i in 1 2 3 4 5; do \
      npx playwright install chromium && break || \
      (echo "Playwright install failed, retrying in 10s..." && sleep 10); \
    done

# 7. 安装 Python 工具和常用技能包
RUN --mount=type=cache,target=/home/node/.cache/pip,uid=1000,gid=1000 \
    pip3 install --user --no-cache-dir --break-system-packages --timeout 600 --retries 10 \
    pydantic "playwright>=1.49.0" crawl4ai \
    requests httpx aiohttp beautifulsoup4 lxml defusedxml pyyaml \
    pandas numpy pypdf pdfplumber pdf2image Pillow \
    openpyxl python-docx python-pptx yfinance anthropic mcp && \
    export PATH="/home/node/.local/bin:$PATH" && \
    PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-python crawl4ai-setup

ENV PATH="/home/node/.local/bin:${PATH}"

# 8. 复制源码并构建
COPY --chown=node:node . .
RUN npm run build

# 9. 备份初始化数据
RUN cp -r /app/skills /app/skills-default && \
    cp -r /app/data/agent-profiles /app/agent-profiles-default

EXPOSE 8118
CMD ["bash", "/app/docker-entrypoint.sh"]
