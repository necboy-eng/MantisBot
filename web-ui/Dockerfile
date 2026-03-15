FROM node:22-alpine AS builder

WORKDIR /app

# 配置 npm 国内镜像
RUN npm config set registry https://registry.npmmirror.com

COPY package*.json ./

# 使用 npm 缓存挂载
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

# 接收从 Makefile buildx-webui 传入的 VERSION build-arg
ARG VERSION=0.0.0
ENV VERSION=${VERSION}

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
