#!/bin/bash
set -e

# 初始化 skills 目录：卷首次挂载时为空，从内置备份复制
# 已有内容（用户自建 skill）则跳过，不覆盖
if [ -z "$(ls -A /app/skills 2>/dev/null)" ]; then
  echo "[Entrypoint] Initializing skills from built-in defaults..."
  cp -r /app/skills-default/. /app/skills/
  echo "[Entrypoint] Skills initialized."
fi

# 初始化人格文件：首次启动时从备份复制默认人格
if [ ! -d "/app/data/agent-profiles" ] || [ -z "$(ls -A /app/data/agent-profiles 2>/dev/null)" ]; then
  echo "[Entrypoint] Initializing agent profiles from built-in defaults..."
  mkdir -p /app/data/agent-profiles
  cp -r /app/agent-profiles-default/. /app/data/agent-profiles/
  echo "[Entrypoint] Agent profiles initialized."
fi

# 确保 Python 虚拟环境存在且可用
if [ ! -f "/app/python-venv/bin/activate" ]; then
  echo "[Entrypoint] Creating Python virtual environment..."
  python3 -m venv /app/python-venv
fi

# 激活虚拟环境（使用 . 代替 source，兼容 sh）
. /app/python-venv/bin/activate

# crawl4ai 使用独立的浏览器路径，与 Node.js playwright (/app/.playwright) 隔离
export PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-python

# 检查基础包是否已安装，如果没有则安装
if ! python3 -c "import requests" 2>/dev/null; then
  echo "[Entrypoint] Installing Python packages for skills..."
  # 写入初始化标记文件，Node.js 启动后读取此文件以决定 /health 的返回状态
  mkdir -p /app/data
  echo "installing_python_packages" > /app/data/.init-status

  # crawl4ai（网页爬取）
  pip install --no-cache-dir \
    crawl4ai

  # 核心包
  pip install --no-cache-dir \
    requests \
    httpx \
    aiohttp \
    beautifulsoup4 \
    lxml \
    defusedxml \
    pyyaml

  # 数据处理
  pip install --no-cache-dir \
    pandas \
    numpy

  # PDF 处理
  pip install --no-cache-dir \
    pypdf \
    pdfplumber \
    pdf2image

  # 图像处理
  pip install --no-cache-dir \
    Pillow

  # Office 文件处理
  pip install --no-cache-dir \
    openpyxl \
    python-docx \
    python-pptx

  # 股票数据
  pip install --no-cache-dir \
    yfinance

  # MCP 和 Claude API
  pip install --no-cache-dir \
    anthropic \
    mcp

  echo "[Entrypoint] Python packages installed successfully!"
  # 删除初始化标记文件，通知 Node.js 初始化已完成
  rm -f /app/data/.init-status
fi

# 启动应用
exec node dist/entry.js
