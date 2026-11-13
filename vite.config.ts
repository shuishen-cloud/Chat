import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const rootDir = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  // 子路径部署时由构建环境注入（如 /deepchat/）；本地开发/根路径部署默认 "/"
  base: process.env.APP_BASE || "/",
  plugins: [react(), tailwindcss()],
  /*
   * 把「是否启用服务端同步」编译期写死，前端据此决定要不要发请求。
   * 生产构建恒为 "1"；dev 下只有显式设了 VITE_API_PROXY（联调多端）才为 "1"。
   * 见 src/lib/storage.ts 的 REMOTE_SYNC_ENABLED。
   */
  define: {
    __REMOTE_SYNC__: JSON.stringify(
      /*
       * 生产构建恒启用；dev 下只有设了 VITE_API_PROXY（真实后端联调）才启用。
       * 注意 vite 的 `define` 在 dev 与 build 都是**构建时**求值，
       * 因此这里读到的是本次命令的环境变量，正是我们要的语义。
       */
      process.env.NODE_ENV === "production" || process.env.VITE_API_PROXY
        ? "1"
        : "0"
    ),
  },
  /*
   * 固定端口并显式绑 127.0.0.1：
   * scripts/test-*.cjs 默认连接 http://127.0.0.1:5199/，
   * 而 Vite 默认端口是 5173/5174、且只监听 [::1]，
   * 会让测试直接 ERR_CONNECTION_REFUSED。
   */
  server: {
    port: 5199,
    strictPort: true,
    host: "127.0.0.1",
    /*
     * 多端同步默认不参与本地开发，只有显式设置 VITE_API_PROXY 才启用。
     *
     * 原因：同步会让「刷新页面从服务端拉数据」成为行为的一部分，
     * 而既有 Playwright 用例默认「localStorage 就是全部状态」——
     * 一个进程级 mock 会被所有 context 共享，用例之间互相污染。
     * 解耦后：
     *   - 日常 `npm run dev`：纯本地，行为与改动前一致
     *   - 联调多端：先 `node server/index.ts`，再
     *     `VITE_API_PROXY=http://127.0.0.1:3000 npm run dev`
     *   - 生产：`server/index.ts` 同时提供 API 与静态产物
     *
     * 未设置时前端请求 /api/state 会拿到 SPA 回落（HTML），
     * fetchRemoteState 解析失败返回 null，同步自动降级为纯本地。
     */
    proxy: process.env.VITE_API_PROXY
      ? { "/api": process.env.VITE_API_PROXY }
      : undefined,
  },
  preview: {
    port: 5199,
    strictPort: true,
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
})
