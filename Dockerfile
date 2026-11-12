# ---- 构建阶段：装依赖 + 打前端产物 ----
FROM node:22-alpine AS builder

WORKDIR /app

# 先只拷锁文件，让依赖层可被缓存：只改源码时不必重装 node_modules
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---- 运行阶段：只保留静态产物，静态服务交给 nginx ----
FROM nginx:1.27-alpine AS runtime

# 覆盖默认站点配置（含 SPA 回落、gzip、长缓存）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# dist 里只有 index.html + assets/，不带 node_modules 与源码
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx 官方镜像默认前台启动，无需额外 CMD
