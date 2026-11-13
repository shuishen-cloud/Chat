/**
 * shadcn-chat 服务端：状态存取 + 静态产物。
 *
 * 替代原来的 nginx 单容器：一个进程同时提供
 *   - `GET/PUT /api/state`  —— 整包对话状态的权威副本
 *   - `dist/` 静态文件      —— 前端产物，含 SPA 回落
 *
 * 目标是「一个人、多端、刷新后看到同一份历史」，因此没有鉴权、
 * 没有实时推送、没有增量同步；鉴权靠部署层（内网 / 反向代理）。
 */
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { readState, writeState } from "./store.ts"

const app = new Hono()

app.get("/api/health", (c) => c.json({ ok: true }))

app.get("/api/state", async (c) => {
  const stored = await readState()
  // index.html 必须每次校验，否则发版后用户拿到旧资源引用
  return c.json(stored, 200, { "cache-control": "no-store" })
})

/**
 * 整包覆盖写入。
 *
 * `base` 是客户端上次见到的 `updatedAt`。不匹配说明别的设备已经写过，
 * 这时覆盖会让那边的新消息消失——宁可让客户端重新拉一遍。
 */
app.put("/api/state", async (c) => {
  const baseRaw = c.req.query("base")
  if (baseRaw === undefined) {
    return c.json({ error: "missing base" }, 400)
  }
  const base = Number(baseRaw)
  if (!Number.isFinite(base)) {
    return c.json({ error: "invalid base" }, 400)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "invalid json" }, 400)
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "body must be a ChatState object" }, 400)
  }

  const current = await readState()
  if (base !== current.updatedAt) {
    return c.json({ updatedAt: current.updatedAt }, 409)
  }

  const next = await writeState(body)
  console.log(
    `[state] 写入 updatedAt=${next.updatedAt} ${JSON.stringify(body).length}B`
  )
  return c.json({ updatedAt: next.updatedAt })
})

/* ---------------- 静态产物 ---------------- */

/**
 * 入口 HTML 必须每次校验：否则发版后用户仍引用旧 hash 资源，页面白屏。
 *
 * 必须放在 `/*` 之前——serveStatic 会先命中通配路由，
 * 之后再设 header 已经晚了。
 */
app.get("/index.html", async (c) => {
  const { readFile } = await import("node:fs/promises")
  const { resolve } = await import("node:path")
  try {
    const html = await readFile(resolve("dist/index.html"), "utf8")
    return c.html(html, 200, { "cache-control": "no-cache, must-revalidate" })
  } catch {
    return c.text("dist/index.html 不存在，请先 npm run build", 500)
  }
})

// 带内容哈希的构建产物：可长期强缓存
app.use(
  "/assets/*",
  serveStatic({
    root: "./dist",
    onFound: (_path, c) => {
      c.header("cache-control", "public, max-age=31536000, immutable")
    },
  })
)

app.use("/*", serveStatic({ root: "./dist" }))

/**
 * SPA 回落：前端路由刷新不 404，且入口 HTML 必须 no-cache。
 *
 * 只对「看起来是页面请求」的路径回落，`/api/*` 的未知路径仍返回 404，
 * 免得把 API 打错的情况伪装成 200 页面。
 */
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound()

  const { readFile } = await import("node:fs/promises")
  const { resolve } = await import("node:path")
  try {
    const html = await readFile(resolve("dist/index.html"), "utf8")
    return c.html(html, 200, { "cache-control": "no-cache, must-revalidate" })
  } catch {
    return c.text("dist/index.html 不存在，请先 npm run build", 500)
  }
})
const port = Number(process.env.PORT || 3000)
console.log(`[server] listening on http://127.0.0.1:${port}`)
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" })
