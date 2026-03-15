#!/bin/bash
set -e

# 初始化 skills 目录：卷首次挂载时为空，从内置备份复制
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
# 注意：在 Dockerfile 中安装的包是安装在系统环境下的 (--break-system-packages)
# 这里保留 venv 逻辑是为了让用户可以后续通过终端自行安装其它包而不污染系统环境
if [ ! -f "/app/python-venv/bin/activate" ]; then
  echo "[Entrypoint] Creating Python virtual environment..."
  python3 -m venv /app/python-venv --system-site-packages
fi

# 激活虚拟环境
. /app/python-venv/bin/activate

# 导出浏览器路径
export PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-python

echo "[Entrypoint] Environment ready, starting MantisBot..."

# 启动应用
exec node dist/entry.js
