/**
 * 轻量测试基座：复用浏览器、缩短超时、提供常用快捷方法。
 *
 * 用法：
 *   const { run } = require("./harness.cjs")
 *   run(async (t) => {
 *     await t.seed({ ... })
 *     await t.select("消息里的文字")
 *     t.eq(await t.count("strong"), 1, "粗体渲染")
 *   })
 */
const { chromium } = require("playwright")

const URL = process.env.APP_URL || "http://127.0.0.1:5199/"
/** 全局默认超时：从 30s 降到 4s，选择器写错立刻失败而不是干等 */
const TIMEOUT = Number(process.env.TIMEOUT || 4000)

/** 默认种子数据，覆盖项目/对话/收藏/标签 */
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
            content: "可以先用 Zustand，它轻量且没有样板代码。团队大了可考虑 Redux Toolkit。",
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

/** SSE 响应构造，便于 mock DeepSeek */
function sse(text) {
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    `data: [DONE]\n\n`
  )
}

async function createHarness(browser) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(TIMEOUT)
  page.setDefaultNavigationTimeout(TIMEOUT * 3)

  const errors = []
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text())
  })

  const checks = []
  const t = {
    page,
    errors,
    checks,

    /** 断言 */
    ok(cond, msg) {
      checks.push({ ok: !!cond, msg })
      console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`)
      if (!cond) throw new Error("断言失败: " + msg)
    },
    eq(actual, expected, msg) {
      t.ok(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${msg} (期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)})`
      )
    },

    /** 注入状态并重载，替代手写 localStorage + reload */
    async seed(state) {
      await page.goto(URL, { waitUntil: "domcontentloaded" })
      await page.evaluate(
        (s) => localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s)),
        state ?? defaultSeed()
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      // 等首屏渲染出侧边栏即可，不必等 networkidle
      await page.locator("aside").first().waitFor({ state: "visible" })
    },

    /** 读取当前持久化状态 */
    state() {
      return page.evaluate(() =>
        JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
      )
    },

    /** mock DeepSeek 流式响应 */
    async mockReply(text) {
      await page.route("**/chat/completions", (route) =>
        route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sse(text),
        })
      )
    },

    /** 在指定消息内选中一段文字（用 DOM Range 精确定位，避免坐标猜测） */
    async selectIn(messageId, chars = 160) {
      const ok = await page.evaluate(
        ({ id, chars }) => {
          const holder = document.querySelector(`[data-message-id='${id}']`)
          if (!holder) return false
          // 找最内层的文本节点
          const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
          // 跳过头像/标签等短文本，取第一段足够长的正文
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
          // 手动派发，让监听器得知变化
          document.dispatchEvent(new Event("selectionchange"))
          return true
        },
        { id: messageId, chars }
      )
      if (!ok) throw new Error(`消息 ${messageId} 无法选中`)
      await page.locator("div.fixed.z-50").first().waitFor({ state: "visible" })
    },

    /** 点悬浮气泡/窗口内的按钮（只找未展开的气泡） */
    async clickInFloat(name) {
      await page
        .locator("div.fixed.z-50:not(.overflow-hidden)")
        .getByRole("button", { name })
        .first()
        .click()
    },

    /** 全局按钮点击（限定容器时可传 scope） */
    async click(name, scope = "body") {
      await page.locator(scope).getByRole("button", { name }).first().click()
    },

    count(selector, scope = "body") {
      return page.locator(scope).locator(selector).count()
    },

    text(scope = "body") {
      return page.locator(scope).first().innerText()
    },

    /** 等待某个条件成立（轮询，避免固定 sleep） */
    async until(fn, timeout = TIMEOUT) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await fn()) return true
        await page.waitForTimeout(50)
      }
      return false
    },

    shot(name) {
      return page.screenshot({ path: `/tmp/shot-${name}.png` })
    },
  }
  return t
}

/**
 * 运行一组测试。共用同一个浏览器实例，各用例开新 context 隔离存储。
 */
function run(fn) {
  return (async () => {
    const t0 = Date.now()
    const browser = await chromium.launch({ channel: "chromium" })
    let failed = 0
    try {
      const t = await createHarness(browser)
      try {
        await fn(t)
      } finally {
        if (t.errors.length) {
          console.log("\n控制台错误:")
          t.errors.forEach((e) => console.log("  " + e))
          failed++
        } else {
          console.log("\n控制台错误: 无")
        }
        await t.page.close()
      }
    } catch (e) {
      console.error("\n失败:", e.message)
      failed++
    } finally {
      await browser.close()
    }
    const ms = Date.now() - t0
    console.log(`\n耗时 ${ms}ms ${failed ? "✗ 失败" : "✓ 全部通过"}`)
    process.exit(failed ? 1 : 0)
  })()
}

module.exports = { run, sse, defaultSeed, URL }
