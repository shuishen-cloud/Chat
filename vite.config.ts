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
   * 固定端口并显式绑 127.0.0.1：
   * scripts/test-*.cjs 默认连接 http://127.0.0.1:5199/，
   * 而 Vite 默认端口是 5173/5174、且只监听 [::1]，
   * 会让测试直接 ERR_CONNECTION_REFUSED。
   */
  server: {
    port: 5199,
    strictPort: true,
    host: "127.0.0.1",
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
