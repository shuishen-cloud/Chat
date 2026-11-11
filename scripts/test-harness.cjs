/**
 * 轻量测试基座。
 *
 * 设计要点（针对速度）：
 *  1. 整个进程只启动一次浏览器，所有用例复用同一个 page
 *  2. 用例之间只清 localStorage + reload，不重建 context/browser
 *  3. 用轮询等待替代固定 sleep，条件满足立刻继续
 *  4. 默认超时 3s，选择器写错快速失败
 *
 * 用法：
 *   const { runAll } = require("./test-harness.cjs")
 *   runAll({ case1: async (t) => {...}, case2: async (t) => {...} })
 */
const { chromium } = require("playwright")

const URL = process.env.APP_URL || "http://127.0.0.1:5199/"
const TIMEOUT = Number(process.env.TIMEOUT || 3000)

/** 默认种子数据 */
function defaultSeed() {
  const now = Date.now()
  return {
    projects: [{ id: "p1", name: "前端重构", createdAt: now }],
    conversations: [
      {
        id: "c1",
        projectId: "p1",
        title: "状态管理",
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: "m1", role: "user", content: "推荐一个状态管理方案", createdAt: now },
          {
            id: "m2",
            role: "assistant",
            content:
              "可以先用 Zustand，它轻量且没有样板代码。团队大了可考虑 Redux Toolkit。",
            createdAt: now,
          },
        ],
      },
    ],
    favorites: [],
    tags: [],
    activeProjectId: "p1",
    activeConversationId: "c1",
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    sidebarView: "list",
  }
}

function sse(text) {
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    `data: [DONE]\n\n`
  )
}

async function createHarness(browser, context) {
  // 每个用例独立 context：storage 天然隔离，避免用例间状态泄漏
  const ctx = context ?? (await browser.newContext({ viewport: { width: 1500, height: 950 } }))
  const page = await ctx.newPage()
  page.setDefaultTimeout(TIMEOUT)
  page.setDefaultNavigationTimeout(TIMEOUT * 3)

  let errors = []
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text())
  })

  let checks = []
  const t = {
    page,
    get errors() {
      return errors
    },
    get checks() {
      return checks
    },

    ok(cond, msg) {
      checks.push({ ok: !!cond, msg })
      if (!cond) throw new Error("断言失败: " + msg)
    },
    eq(actual, expected, msg) {
      t.ok(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${msg} (期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)})`
      )
    },

    /** 注入状态；只 reload 一次，不重新 goto */
    async seed(state) {
      const data = { ...(state ?? defaultSeed()) }
      data.boards = data.boards ?? []

      // 清空全部应用数据，避免用例间状态泄漏
      await page.evaluate((s) => {
        localStorage.clear()
        localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s))
      }, data)
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator("aside").first().waitFor({ state: "visible" })
      // 等 React 真正挂载完新数据：侧边栏出现会话项（空库时为 0）
      await page.waitForFunction(
        (expectFirst) => {
          const items = document.querySelectorAll("aside span.truncate")
          if (expectFirst === null) return true
          return Array.from(items).some((el) => el.textContent === expectFirst)
        },
        data.conversations?.[0]?.title ?? null,
        { timeout: TIMEOUT }
      ).catch(() => {})
    },

    state() {
      return page.evaluate(() =>
        JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
      )
    },

    /**
     * 读取持久化状态，直到满足条件。
     * 状态写入有 200ms 防抖，直接读可能拿到旧值。
     */
    async stateUntil(predicate, timeout = TIMEOUT, label = "状态条件") {
      const start = Date.now()
      let last
      while (Date.now() - start < timeout) {
        try {
          last = await t.state()
          if (predicate(last)) return last
        } catch {
          /* 忽略解析失败 */
        }
        await page.waitForTimeout(40)
      }
      throw new Error(
        `${label} 超时，最后一次状态: ${JSON.stringify(last)?.slice(0, 200)}`
      )
    },

    /** 等某个元素达到数量 */
    async untilCount(selector, n, timeout = TIMEOUT, scope = "body") {
      const ok = await t.until(
        async () => (await page.locator(scope).locator(selector).count()) === n,
        timeout
      )
      if (!ok) {
        const actual = await page.locator(scope).locator(selector).count()
        throw new Error(`等待 ${selector} 数量 ${n} 失败，实际 ${actual}`)
      }
    },

    /** 等元素可见 */
    async untilVisible(selector) {
      await page.locator(selector).first().waitFor({ state: "visible" })
    },

    async mockReply(text) {
      await page.unroute("**/chat/completions").catch(() => {})
      await page.route("**/chat/completions", (route) =>
        route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sse(text),
        })
      )
    },

    async unmockReply() {
      await page.unroute("**/chat/completions").catch(() => {})
    },

    /** 在指定消息内选中文字（DOM Range，避免坐标猜测） */
    async selectIn(messageId, chars = 160) {
      const ok = await page.evaluate(
        ({ id, chars }) => {
          const holder = document.querySelector(`[data-message-id='${id}']`)
          if (!holder) return false
          const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node && node.textContent.trim().length < 8) node = walker.nextNode()
          if (!node) return false
          const len = Math.min(chars, node.textContent.length)
          const range = document.createRange()
          range.setStart(node, 0)
          range.setEnd(node, len)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          document.dispatchEvent(new Event("selectionchange"))
          return true
        },
        { id: messageId, chars }
      )
      if (!ok) throw new Error(`消息 ${messageId} 无法选中`)
      await page.locator("div.fixed.z-50").first().waitFor({ state: "visible" })
    },

    async clickInFloat(name) {
      await page
        .locator("div.fixed.z-50:not(.overflow-hidden)")
        .getByRole("button", { name })
        .first()
        .click()
    },

    async click(name, scope = "body") {
      await page.locator(scope).getByRole("button", { name }).first().click()
    },

    count(selector, scope = "body") {
      return page.locator(scope).locator(selector).count()
    },

    text(scope = "body") {
      return page.locator(scope).first().innerText()
    },

    /** 轮询等待条件成立，替代固定 sleep */
    async until(fn, timeout = TIMEOUT) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await fn()) return true
        await page.waitForTimeout(30)
      }
      return false
    },

    /** 等待持久化状态满足条件 */
    async untilState(predicate, timeout = TIMEOUT) {
      return t.until(async () => {
        try {
          return predicate(await t.state())
        } catch {
          return false
        }
      }, timeout)
    },

    /** 等 React 完成一次渲染（比固定 sleep 可靠且更快） */
    settle() {
      return page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
      )
    },

    shot(name) {
      return page.screenshot({ path: `/tmp/shot-${name}.png` })
    },
  }
  return { t, ctx }
}

/**
 * 串行运行全部用例：浏览器只启动一次。
 * 每个用例前清错误收集，便于定位失败来源。
 */
async function runAll(cases, opts = {}) {
  const t0 = Date.now()
  const browser = await chromium.launch({ channel: "chromium" })
  let t
  const results = []

  try {
    for (const [name, fn] of Object.entries(cases)) {
      if (opts.only && opts.only !== name) continue
      const start = Date.now()
      // 每个用例独立 context，storage 完全隔离
      const { t: tc, ctx } = await createHarness(browser)
      t = tc
      t.errors.length = 0
      t.checks.length = 0
      await t.page.goto(URL, { waitUntil: "domcontentloaded" })
      try {
        await fn(t)
        if (t.errors.length) {
          throw new Error(
            "控制台错误: " + t.errors.slice(0, 3).join(" | ")
          )
        }
        results.push({ name, ok: true, ms: Date.now() - start })
        console.log(`  ✓ ${name} (${Date.now() - start}ms)`)
      } catch (e) {
        results.push({ name, ok: false, ms: Date.now() - start, err: e.message })
        console.log(`  ✗ ${name} (${Date.now() - start}ms)`)
        console.log(`    ${e.message.split("\n")[0]}`)
      } finally {
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
  }

  const passed = results.filter((r) => r.ok).length
  const total = results.length
  console.log(
    `\n${passed}/${total} 通过 · 总耗时 ${Date.now() - t0}ms`
  )
  if (passed !== total) {
    console.log("\n失败项:")
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.err}`))
  }
  process.exit(passed === total ? 0 : 1)
}

module.exports = { runAll, sse, defaultSeed, URL }
