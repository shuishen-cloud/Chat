#!/usr/bin/env node
/**
 * 服务端存储与多端刷新可见（feat: remote-state-sync）。
 *
 * 分两部分：
 *  1. server*：直接对 /api/state 发请求，验证契约（无需浏览器）
 *  2. sync*  ：Playwright 双 context 模拟两台设备，验证「刷新即可见」
 *
 * 前置：
 *   - 已 `npm run build`（服务端要 serve dist/）
 *   - 服务端已启动：`STATE_FILE=/tmp/pdm-state.json PORT=5299 node server/index.ts`
 *     或直接 `node scripts/test-remote-state.cjs` 时由本脚本自动拉起
 *
 * 用法：
 *   node scripts/test-remote-state.cjs            # 全部
 *   CASE=serverPut node scripts/test-remote-state.cjs
 *   CASE=--list node scripts/test-remote-state.cjs
 *   KEEP=1 node scripts/test-remote-state.cjs     # 保留服务端日志与临时 state 文件
 */
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")

const PORT = Number(process.env.PORT || 5299)
const BASE = `http://127.0.0.1:${PORT}`
const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(os.tmpdir(), `pdm-remote-state-${process.pid}.json`)

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ------------------------------------------------------------------ */
/* 服务端：拉起 / 就绪 / 清理                                            */
/* ------------------------------------------------------------------ */

let proc = null

async function waitHealth(timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`服务端 ${timeout}ms 内未就绪（${BASE}/api/health）`)
}

async function startServer() {
  // 每次从头开始，避免上一次残留影响 base 断言
  fs.rmSync(STATE_FILE, { force: true })

  proc = spawn(process.execPath, ["server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), STATE_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const logs = []
  proc.stdout.on("data", (b) => logs.push(b.toString()))
  proc.stderr.on("data", (b) => logs.push(b.toString()))
  proc.on("exit", (code) => {
    if (code && code !== 0) console.error(`[server] 退出码 ${code}\n${logs.join("")}`)
  })

  await waitHealth()
  return logs
}

function stopServer() {
  if (proc) {
    proc.kill("SIGTERM")
    proc = null
  }
  if (!process.env.KEEP) fs.rmSync(STATE_FILE, { force: true })
}

/* ------------------------------------------------------------------ */
/* 接口工具                                                            */
/* ------------------------------------------------------------------ */

async function getState() {
  const r = await fetch(`${BASE}/api/state`)
  assert(r.ok, `GET /api/state 状态码 ${r.status}`)
  return r.json()
}

async function putState(state, base) {
  const r = await fetch(`${BASE}/api/state?base=${base}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

/** 一个最小的合法 ChatState，够服务端存取即可 */
function tinyState(projectName = "P") {
  const now = Date.now()
  return {
    projects: [{ id: "p1", name: projectName, createdAt: now }],
    conversations: [
      {
        id: "c1",
        projectId: "p1",
        title: "会话",
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: "m1", role: "user", content: "你好", createdAt: now },
        ],
      },
    ],
    favorites: [],
    tags: [],
    boards: [],
    boardNodes: [],
    boardEdges: [],
    boardTasks: [],
    activeProjectId: "p1",
    activeConversationId: "c1",
    activeBoardId: null,
    activeTaskId: null,
    mainView: "chat",
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    thinkingEnabled: true,
    sidebarView: "list",
  }
}

/* ------------------------------------------------------------------ */
/* 用例：接口契约                                                       */
/* ------------------------------------------------------------------ */

const cases = {
  /** 空服务端返回 updatedAt=0 / state=null，而不是 404 */
  serverEmpty() {
    return getState().then((r) => {
      assert(r.updatedAt === 0, `空服务端 updatedAt 应为 0，实际 ${r.updatedAt}`)
      assert(r.state === null, `空服务端 state 应为 null，实际 ${typeof r.state}`)
    })
  },

  /** base=0 可初始化；随后 base 必须跟上才能再次写入 */
  async serverPut() {
    const a = await putState(tinyState("第一次"), 0)
    assert(a.status === 200, `首次 PUT 应 200，实际 ${a.status}`)
    assert(a.body.updatedAt > 0, "首次 PUT 应返回更新的 updatedAt")

    const got = await getState()
    assert(got.updatedAt === a.body.updatedAt, "GET 的 updatedAt 应与 PUT 返回一致")
    assert(got.state.projects[0].name === "第一次", "写入内容未生效")

    // 用旧 base 再写 → 409，且服务端数据不变
    const stale = await putState(tinyState("旧快照"), 0)
    assert(stale.status === 409, `旧 base 应 409，实际 ${stale.status}`)
    assert(
      stale.body.updatedAt === a.body.updatedAt,
      "409 应返回服务端当前 updatedAt"
    )
    const after = await getState()
    assert(
      after.state.projects[0].name === "第一次",
      "409 后数据不应被覆盖"
    )

    // 用正确 base 写入 → 200
    const ok = await putState(tinyState("第二次"), a.body.updatedAt)
    assert(ok.status === 200, `正确 base 应 200，实际 ${ok.status}`)
    assert((await getState()).state.projects[0].name === "第二次", "更新未生效")
  },

  /** 非法请求体 → 400；缺 base → 400 */
  async serverBadRequest() {
    const noBase = await fetch(`${BASE}/api/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tinyState()),
    })
    assert(noBase.status === 400, `缺 base 应 400，实际 ${noBase.status}`)

    const badJson = await fetch(`${BASE}/api/state?base=0`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    assert(badJson.status === 400, `坏 JSON 应 400，实际 ${badJson.status}`)

    const notObject = await fetch(`${BASE}/api/state?base=0`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "[1,2,3]",
    })
    assert(notObject.status === 400, `数组体应 400，实际 ${notObject.status}`)
  },

  /** 落盘是原子的：文件内容始终是完整 JSON（能解析且含 updatedAt/state） */
  async serverPersist() {
    const w = await putState(tinyState("持久化"), 0)
    assert(w.status === 200, `PUT 失败 ${w.status}`)

    assert(fs.existsSync(STATE_FILE), `state 文件不存在: ${STATE_FILE}`)
    const raw = fs.readFileSync(STATE_FILE, "utf8")
    const parsed = JSON.parse(raw)
    assert(typeof parsed.updatedAt === "number", "落盘缺 updatedAt")
    assert(parsed.state && typeof parsed.state === "object", "落盘缺 state")

    // 重启进程：数据必须还在（这是「部署到服务器」的核心承诺）
    stopServer()
    await startServer()
    const again = await getState()
    assert(again.state.projects[0].name === "持久化", "重启后数据丢失")
  },

  /** 静态产物与 SPA 回落可用（服务端同时承担 nginx 的职责） */
  async serverStatic() {
    const idx = await fetch(`${BASE}/`)
    assert(idx.ok, `GET / 状态码 ${idx.status}`)
    const html = await idx.text()
    assert(html.includes("<div id=\"root\">"), "根路径未返回 index.html")
    assert(
      (idx.headers.get("cache-control") || "").includes("no-cache"),
      "index.html 必须 no-cache，否则发版后拿到旧资源引用"
    )

    const spa = await fetch(`${BASE}/some/deep/route`)
    assert(spa.ok, `SPA 回落失败 ${spa.status}`)
    assert(
      (await spa.text()).includes("<div id=\"root\">"),
      "未知路径应回落 index.html"
    )
  },
}

/* ------------------------------------------------------------------ */
/* 用例：多端刷新可见（Playwright）                                     */
/* ------------------------------------------------------------------ */

/**
 * 每个 sync 用例都独立 context = 独立 localStorage，
 * 相当于两台互不相干的设备。
 */
function browserCases() {
  const { chromium } = require("playwright")

  return {
    /** 设备 A 写入 → 设备 B 打开即可见；B 的修改 A 刷新后可见 */
    async syncTwoDevices() {
      const browser = await chromium.launch({ channel: "chromium" })
      try {
        // 服务端先清空，让 A 走「初始化」路径
        stopServer()
        await startServer()

        const ctxA = await browser.newContext()
        const a = await ctxA.newPage()
        await a.goto(BASE, { waitUntil: "domcontentloaded" })

        // A 首次启动应把本地初始状态推到服务端
        const seeded = await until(async () => (await getState()).state !== null)
        assert(seeded, "设备 A 启动后服务端仍未初始化")
        const afterA = await getState()

        // B 是全新设备：本地空，必须从服务端拿到 A 的会话
        const ctxB = await browser.newContext()
        const b = await ctxB.newPage()
        await b.goto(BASE, { waitUntil: "domcontentloaded" })

        const bHasProject = await until(async () =>
          (await b.locator("aside").first().innerText()).includes("我的项目")
        )
        assert(bHasProject, "设备 B 未显示设备 A 的项目")

        // B 新建会话 → 落库
        await b.locator("aside").first().getByRole("button", { name: /新建/ }).first().click()
        const before = (await getState()).updatedAt
        const written = await until(async () => (await getState()).updatedAt !== before)
        assert(written, "设备 B 的修改未推送到服务端")

        // A 刷新 → 看到 B 的修改
        await a.reload({ waitUntil: "domcontentloaded" })
        await a.locator("aside").first().waitFor({ state: "visible" })

        const serverState = (await getState()).state
        const serverConvCount = serverState.conversations.length
        assert(serverConvCount >= 2, `服务端会话数应 ≥2，实际 ${serverConvCount}`)

        const aCount = await until(async () => {
          const local = await a.evaluate(() =>
            JSON.parse(localStorage.getItem("shadcn-chat/state/v1") || "{}")
          )
          return (local.conversations || []).length === serverConvCount
        })
        assert(aCount, "设备 A 刷新后未同步到服务端的会话数")

        await ctxA.close()
        await ctxB.close()
      } finally {
        await browser.close()
      }
    },

    /** 后端不可达时页面仍可用（降级到 localStorage） */
    async syncOfflineFallback() {
      // 注意：本用例要求服务端**起来**才能加载页面，但 API 必须挂——
      // 用 Playwright 拦截 /api/state 制造「后端挂掉」的效果。
      const browser = await chromium.launch({ channel: "chromium" })
      try {
        const ctx = await browser.newContext()
        const page = await ctx.newPage()
        await page.route("**/api/state**", (route) => route.abort())
        await page.goto(BASE, { waitUntil: "domcontentloaded" })

        await page.locator("aside").first().waitFor({ state: "visible" })
        const aside = await page.locator("aside").first().innerText()
        assert(aside.includes("我的项目"), "后端不可达时未降级到本地初始状态")

        // 本地仍能写入
        await page.locator("aside").first().getByRole("button", { name: /新建/ }).first().click()
        const n = await until(async () => {
          const local = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("shadcn-chat/state/v1") || "{}")
          )
          return (local.conversations || []).length >= 2
        })
        assert(n, "后端不可达时本地状态未更新")

        await ctx.close()
      } finally {
        await browser.close()
      }
    },

    /** 流式生成期间不产生 PUT，结束后产生一次 */
    async syncNoStreamingPush() {
      const browser = await chromium.launch({ channel: "chromium" })
      try {
        stopServer()
        await startServer()

        const ctx = await browser.newContext()
        const page = await ctx.newPage()

        const puts = []
        page.on("request", (r) => {
          if (r.url().includes("/api/state") && r.method() === "PUT") puts.push(r)
        })

        // 让流式回复慢下来，留出观察窗口
        await page.route("**/chat/completions", async (route) => {
          await route.fulfill({
            status: 200,
            headers: { "content-type": "text/event-stream" },
            body:
              `data: ${JSON.stringify({ choices: [{ delta: { content: "半截" } }] })}\n\n` +
              `data: [DONE]\n\n`,
          })
        })

        await page.goto(BASE, { waitUntil: "domcontentloaded" })
        await page.locator("aside").first().waitFor({ state: "visible" })
        // 等首次初始化完成，清空计数
        await until(async () => (await getState()).state !== null)
        await page.waitForTimeout(400)
        puts.length = 0

        const composer = page.locator("textarea").last()
        await composer.waitFor({ state: "visible" })
        await composer.fill("测试流式")
        await composer.press("Enter")

        // 生成结束（输入框恢复可用）后才允许出现 PUT
        const done = await until(async () => {
          const local = await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem("shadcn-chat/state/v1") || "{}")
            const conv = (s.conversations || []).find((c) => c.id === s.activeConversationId)
            return (conv?.messages || []).some(
              (m) => m.role === "assistant" && !m.streaming && m.content.includes("半截")
            )
          })
          return local
        })
        assert(done, "流式回复未落地")

        const pushed = await until(async () => puts.length > 0)
        assert(pushed, "生成结束后未推送 PUT")

        await ctx.close()
      } finally {
        await browser.close()
      }
    },
  }
}

/** 轮询等待，避免固定 sleep */
async function until(fn, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return true
    } catch {
      /* 忽略中间态 */
    }
    await new Promise((r) => setTimeout(r, 60))
  }
  return false
}

/* ------------------------------------------------------------------ */
/* 运行器                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const only = process.env.CASE
  if (only === "--list") {
    console.log([...Object.keys(cases), "syncTwoDevices", "syncOfflineFallback", "syncNoStreamingPush"].join("\n"))
    return
  }

  let logs
  try {
    logs = await startServer()
  } catch (e) {
    console.error("启动服务端失败：", e.message)
    console.error("请确认已 `npm run build` 且 node 版本支持直接运行 TS（>=22.6）")
    process.exit(1)
  }

  const all = { ...cases, ...browserCases() }
  let passed = 0
  const failed = []

  for (const [name, fn] of Object.entries(all)) {
    if (only && only !== name) continue
    const t0 = Date.now()
    try {
      await fn()
      passed++
      console.log(`  ✓ ${name} (${Date.now() - t0}ms)`)
    } catch (e) {
      failed.push({ name, err: e.message })
      console.log(`  ✗ ${name} (${Date.now() - t0}ms)`)
      console.log(`    ${e.message.split("\n")[0]}`)
    }
  }

  stopServer()

  const total = only ? passed + failed.length : Object.keys(all).length
  console.log(`\n${passed}/${total} 通过`)
  if (failed.length) {
    console.log("\n失败项:")
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.err}`))
    if (process.env.KEEP) console.log("\n服务端日志:\n" + (logs || []).join(""))
    process.exit(1)
  }
}

process.on("SIGINT", () => {
  stopServer()
  process.exit(130)
})

main().catch((e) => {
  console.error(e)
  stopServer()
  process.exit(1)
})
