# MantisBot Docker 镜像构建和发布
# 用法:
#   make build            - 构建所有镜像（本地单平台）
#   make push             - 推送所有镜像到仓库
#   make release          - 多平台构建并推送全部镜像
#   make release-backend  - 仅构建并推送后端镜像
#   make release-webui    - 仅构建并推送前端镜像
#   make run              - 本地运行 docker-compose
#   make clean            - 清理本地镜像

# 配置变量（可通过环境变量覆盖）
REGISTRY ?= docker.io
IMAGE_PREFIX ?= mantis
VERSION ?= $(shell node -p "require('./package.json').version")
BUILD_DATE ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# 镜像名称
BACKEND_IMAGE := $(REGISTRY)/$(IMAGE_PREFIX)/mantis-bot
WEBUI_IMAGE := $(REGISTRY)/$(IMAGE_PREFIX)/mantis-bot-webui

# 平台支持
PLATFORMS ?= linux/arm64,linux/amd64

.PHONY: help build build-backend build-webui push push-backend push-webui release release-backend release-webui run stop clean tag-latest bump-version bump-minor bump-major

help: ## 显示帮助信息
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================
# 构建镜像
# ============================================

build: build-backend build-webui ## 构建所有镜像

build-backend: ## 构建后端镜像
	@echo "🔨 构建后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	docker build \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--build-arg VERSION=$(VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t $(BACKEND_IMAGE):$(VERSION) \
		-t $(BACKEND_IMAGE):$(GIT_COMMIT) \
		.
	@echo "✅ 后端镜像构建完成"

build-webui: ## 构建 Web UI 镜像
	@echo "🔨 构建 Web UI 镜像: $(WEBUI_IMAGE):$(VERSION)"
	docker build \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--build-arg VERSION=$(VERSION) \
		-t $(WEBUI_IMAGE):$(VERSION) \
		-t $(WEBUI_IMAGE):$(GIT_COMMIT) \
		./web-ui
	@echo "✅ Web UI 镜像构建完成"

# ============================================
# 多平台构建（需要 buildx）
# ============================================

buildx: buildx-backend buildx-webui ## 多平台构建所有镜像（用于发布）

buildx-backend: ## 多平台构建后端镜像
	@echo "🔨 多平台构建后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	docker buildx build \
		--platform $(PLATFORMS) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--build-arg VERSION=$(VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t $(BACKEND_IMAGE):$(VERSION) \
		-t $(BACKEND_IMAGE):latest \
		--push \
		.
	@echo "✅ 后端镜像多平台构建并推送完成"

buildx-webui: ## 多平台构建 Web UI 镜像
	@echo "🔨 多平台构建 Web UI 镜像: $(WEBUI_IMAGE):$(VERSION)"
	docker buildx build \
		--platform $(PLATFORMS) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--build-arg VERSION=$(VERSION) \
		-t $(WEBUI_IMAGE):$(VERSION) \
		-t $(WEBUI_IMAGE):latest \
		--push \
		./web-ui
	@echo "✅ Web UI 镜像多平台构建并推送完成"

# ============================================
# 推送镜像
# ============================================

push: push-backend push-webui ## 推送所有镜像到仓库

push-backend: ## 推送后端镜像
	@echo "📤 推送后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	docker push $(BACKEND_IMAGE):$(VERSION)
	@echo "✅ 后端镜像推送完成"

push-webui: ## 推送 Web UI 镜像
	@echo "📤 推送 Web UI 镜像: $(WEBUI_IMAGE):$(VERSION)"
	docker push $(WEBUI_IMAGE):$(VERSION)
	@echo "✅ Web UI 镜像推送完成"

tag-latest: ## 为当前版本打 latest 标签
	@echo "🏷️  打 latest 标签"
	docker tag $(BACKEND_IMAGE):$(VERSION) $(BACKEND_IMAGE):latest
	docker tag $(WEBUI_IMAGE):$(VERSION) $(WEBUI_IMAGE):latest
	@echo "✅ latest 标签完成"

# ============================================
# 发布流程
# ============================================

release: bump-version buildx ## 完整发布流程，递增 patch 版本（1.0.0 → 1.0.1）
	@echo "🚀 发布完成!"
	@echo "   后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	@echo "   Web UI: $(WEBUI_IMAGE):$(VERSION)"

release-minor: bump-minor buildx ## 发布 minor 版本（1.0.x → 1.1.0）
	@echo "🚀 发布完成!"
	@echo "   后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	@echo "   Web UI: $(WEBUI_IMAGE):$(VERSION)"

release-major: bump-major buildx ## 发布 major 版本（1.x.x → 2.0.0）
	@echo "🚀 发布完成!"
	@echo "   后端镜像: $(BACKEND_IMAGE):$(VERSION)"
	@echo "   Web UI: $(WEBUI_IMAGE):$(VERSION)"

bump-version: ## 递增 patch 版本号（1.0.0 → 1.0.1）
	@node -e "\
	  const fs = require('fs'); \
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
	  const parts = pkg.version.split('.').map(Number); \
	  parts[2]++; \
	  pkg.version = parts.join('.'); \
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n'); \
	  console.log('📦 版本号更新为: ' + pkg.version); \
	"

bump-minor: ## 递增 minor 版本号（1.0.x → 1.1.0）
	@node -e "\
	  const fs = require('fs'); \
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
	  const parts = pkg.version.split('.').map(Number); \
	  parts[1]++; parts[2] = 0; \
	  pkg.version = parts.join('.'); \
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n'); \
	  console.log('📦 版本号更新为: ' + pkg.version); \
	"

bump-major: ## 递增 major 版本号（x.0.0 → 2.0.0）
	@node -e "\
	  const fs = require('fs'); \
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
	  const parts = pkg.version.split('.').map(Number); \
	  parts[0]++; parts[1] = 0; parts[2] = 0; \
	  pkg.version = parts.join('.'); \
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n'); \
	  console.log('📦 版本号更新为: ' + pkg.version); \
	"

release-backend: buildx-backend ## 仅构建并推送后端镜像
	@echo "🚀 后端发布完成: $(BACKEND_IMAGE):$(VERSION)"

release-webui: buildx-webui ## 仅构建并推送前端镜像
	@echo "🚀 前端发布完成: $(WEBUI_IMAGE):$(VERSION)"

# ============================================
# 本地运行
# ============================================

run: ## 使用 docker-compose 启动服务
	docker-compose up -d
	@echo "✅ 服务已启动"
	@echo "   后端: http://localhost:8118"
	@echo "   Web UI: http://localhost:3081"

stop: ## 停止 docker-compose 服务
	docker-compose down
	@echo "✅ 服务已停止"

logs: ## 查看服务日志
	docker-compose logs -f

# ============================================
# 清理
# ============================================

clean: ## 清理本地镜像
	@echo "🧹 清理本地镜像..."
	docker rmi -f $(BACKEND_IMAGE):$(VERSION) 2>/dev/null || true
	docker rmi -f $(BACKEND_IMAGE):latest 2>/dev/null || true
	docker rmi -f $(WEBUI_IMAGE):$(VERSION) 2>/dev/null || true
	docker rmi -f $(WEBUI_IMAGE):latest 2>/dev/null || true
	@echo "✅ 清理完成"

# ============================================
# 工具命令
# ============================================

login: ## 登录 Docker 仓库
	docker login $(REGISTRY)

info: ## 显示构建信息
	@echo "构建配置:"
	@echo "  镜像仓库: $(REGISTRY)"
	@echo "  镜像前缀: $(IMAGE_PREFIX)"
	@echo "  版本号: $(VERSION)"
	@echo "  Git Commit: $(GIT_COMMIT)"
	@echo "  构建时间: $(BUILD_DATE)"
	@echo "  平台: $(PLATFORMS)"
	@echo ""
	@echo "镜像名称:"
	@echo "  后端: $(BACKEND_IMAGE):$(VERSION)"
	@echo "  Web UI: $(WEBUI_IMAGE):$(VERSION)"
