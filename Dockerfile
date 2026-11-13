# ---- 构建阶段：装依赖 + 打前端产物 ----
FROM node:22-alpine AS builder

WORKDIR /app

# 先只拷锁文件，让依赖层可被缓存：只改源码时不必重装 node_modules
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

# 子路径部署：APP_BASE 同时决定 index.html 与打包产物的资源前缀（见 vite.config.ts）
# 根路径部署可省略，默认 "/"
ARG APP_BASE=/
ENV APP_BASE=${APP_BASE}
RUN npm run build

# 运行阶段只留产物与服务端依赖，不要把 devDependencies 带进去
RUN npm prune --omit=dev

# ---- 运行阶段：一个 Node 进程同时提供 API 与静态产物 ----
# 不再使用 nginx：状态存储需要一个活着的进程，nginx 只能发静态文件。
# 单进程也省掉了一层反代配置，个人自用足够。
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
# 容器内固定路径，再由 volume 挂到宿主机
ENV STATE_FILE=/app/data/state.json
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./

# 状态目录：必须挂卷，否则容器重建即丢全部对话
VOLUME ["/app/data"]

EXPOSE 3000

# node 22 起可直接运行 TypeScript（类型剥离），无需构建步骤
CMD ["node", "server/index.ts"]
