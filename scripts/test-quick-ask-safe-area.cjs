/**
 * 回归测试：划词追问气泡与悬浮窗不得被浏览器原生浮条遮挡。
 *
 * 背景（见 doc/feat/quick-ask-safe-area.md）：
 * 微信/QQ 内置浏览器的「AI 帮写」浮条是浏览器原生 UI，绘制在 WebView 之上，
 * z-index 盖不住。对策是避让：
 *   1. 气泡贴选区右下角（远离屏幕底部）
 *   2. 展开窗贴视口上部，且底边留出 bottomSafeArea()
 *
 * 运行：
 *   npm run build && npx vite preview --port 5199 &
 *   APP_URL=http://127.0.0.1:5199/ node scripts/test-quick-ask-safe-area.cjs
 */
const { defaultSeed } = require("./test-harness.cjs")
const { chromium } = require("playwright")

const WECHAT_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/116.0.0.0 Safari/537.36 MicroMessenger/8.0.42.2460(0x28002A3B) WeChat/arm64"

/** 带多条消息的种子，便于选中靠下/靠右的文本 */
function seed() {
  const base = defaultSeed()
  return {
    ...base,
    conversations: [
      {
        ...base.conversations[0],
        messages: [
          { id: "m1", role: "user", content: "一", createdAt: 1 },
          {
            id: "m2",
            role: "assistant",
            // 足够长，保证能选中、也能滚动到靠下位置
            content:
              "这是可以选中的一段回复内容，用来触发追问气泡的定位断言。".repeat(8),
            createdAt: 2,
          },
        ],
      },
    ],
  }
}

/** 选中 m2 内指定位置的文本，返回选区矩形 */
function selectIn(page, where = "last") {
  return page.evaluate((where) => {
    const holder = document.querySelector("[data-message-id='m2']")
    if (!holder) return null
    const nodes = []
    const w = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) if (n.textContent.trim().length > 4) nodes.push(n)
    if (!nodes.length) return null
    const node = where === "last" ? nodes[nodes.length - 1] : nodes[0]
    const text = node.textContent
    const range = document.createRange()
    if (where === "last") {
      range.setStart(node, Math.max(0, text.length - 8))
      range.setEnd(node, text.length)
    } else {
      range.setStart(node, 0)
      range.setEnd(node, Math.min(10, text.length))
    }
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    const r = range.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      vw: innerWidth,
      vh: innerHeight,
    }
  }, where)
}

const bubbleRect = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-qa='bubble']")
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
    }
  })

const windowRect = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-qa='window']")
    if (!el) return null
    const r = el.getBoundingClientRect()
    const ta = el.querySelector("textarea")?.getBoundingClientRect()
    return {
      y: Math.round(r.y),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      taBottom: ta && Math.round(ta.bottom),
      vh: innerHeight,
    }
  })

/** 断言气泡在选区右下方 */
function assertBubbleAtBottomRight(t, sel, bub, label) {
  t.ok(bub, `${label}: 气泡已渲染`)
  t.ok(bub.x >= sel.right - 2, `${label}: 气泡在选区右侧 (bubble.x=${bub.x} vs sel.right=${sel.right})`)
  t.ok(bub.y >= sel.bottom - 2, `${label}: 气泡在选区下方 (bubble.y=${bub.y} vs sel.bottom=${sel.bottom})`)
}

const cases = {
  async bubbleAtSelectionBottomRight(t) {
    await t.seed(seed())
    const sel = await selectIn(t.page, "first")
    t.ok(sel, "选中了正文文本")
    await t.settle()
    await t.page.locator("[data-qa='bubble']").waitFor({ state: "visible" })
    assertBubbleAtBottomRight(t, sel, await bubbleRect(t.page), "普通位置")
  },

  async windowAvoidsNativeBar(t) {
    await t.seed(seed())
    await selectIn(t.page, "first")
    await t.settle()
    await t.page
      .locator("[data-qa='bubble']")
      .getByRole("button", { name: /追问/ })
      .click()
    await t.page.locator("[data-qa='window']").waitFor({ state: "visible" })
    await t.settle()

    const win = await windowRect(t.page)
    t.ok(win, "悬浮窗已展开")
    // 微信浮条约占底部 90px，这里要求至少留出 90px
    const gap = win.vh - win.bottom
    t.ok(gap >= 90, `窗口底边留出原生浮条安全区 (余量 ${gap}px)`)
    t.ok(
      win.taBottom <= win.vh - 90,
      `输入框不被遮挡 (textarea.bottom=${win.taBottom}, vh=${win.vh})`
    )
  },

  async bubbleFlipsNearBottomEdge(t) {
    await t.seed(seed())
    // 滚到底，让选区贴近视口下缘
    await t.page.evaluate(() => {
      const holder = document.querySelector("[data-message-id='m2']")
      const scroller = holder?.closest("main, .overflow-y-auto")
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      window.scrollTo(0, document.body.scrollHeight)
    })
    await t.settle()
    const sel = await selectIn(t.page, "last")
    t.ok(sel, "选中靠下的文本")
    await t.settle()
    await t.page.locator("[data-qa='bubble']").waitFor({ state: "visible" })
    const bub = await bubbleRect(t.page)
    t.ok(bub, "气泡已渲染")
    // 不能溢出视口底部（留 90px 安全区）与右侧
    t.ok(bub.bottom <= sel.vh - 40, `气泡未越过底部安全区 (bottom=${bub.bottom}, vh=${sel.vh})`)
    t.ok(bub.right <= sel.vw, `气泡未溢出右侧 (right=${bub.right}, vw=${sel.vw})`)
  },
}

/**
 * 自带 runner：需要按 UA / 视口定制 browser context，
 * 而 test-harness 的 runAll 固定用桌面默认 context。
 */
async function main() {
  const browser = await chromium.launch({ channel: "chromium" })
  const targets = [
    { label: "微信 UA 1920x900", ua: WECHAT_UA, vw: 1920, vh: 900 },
    { label: "微信 UA 1920x720", ua: WECHAT_UA, vw: 1920, vh: 720 },
    { label: "普通桌面 1920x900", ua: undefined, vw: 1920, vh: 900 },
  ]
  let pass = 0
  let total = 0
  const only = process.env.CASE

  for (const [name, fn] of Object.entries(cases)) {
    if (only && only !== name) continue
    for (const tgt of targets) {
      total++
      const ctx = await browser.newContext({
        viewport: { width: tgt.vw, height: tgt.vh },
        ...(tgt.ua ? { userAgent: tgt.ua } : {}),
      })
      const page = await ctx.newPage()
      page.setDefaultTimeout(3000)
      await page.goto(process.env.APP_URL || "http://127.0.0.1:5199/", {
        waitUntil: "domcontentloaded",
      })
      const checks = []
      const t = {
        page,
        ok(cond, msg) {
          checks.push({ ok: !!cond, msg })
          if (!cond) throw new Error(msg)
        },
        eq(a, b, msg) {
          t.ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)})`)
        },
        async seed(state) {
          const data = { ...state, boards: state.boards ?? [] }
          await page.evaluate((s) => {
            localStorage.clear()
            localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s))
          }, data)
          await page.reload({ waitUntil: "domcontentloaded" })
          await page.locator("aside").first().waitFor({ state: "visible" })
        },
        settle() {
          return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))))
        },
      }
      try {
        await fn(t)
        pass++
        console.log(`  ✓ ${name} · ${tgt.label}`)
      } catch (e) {
        console.log(`  ✗ ${name} · ${tgt.label}`)
        console.log(`    ${e.message.split("\n")[0]}`)
      } finally {
        await ctx.close()
      }
    }
  }

  await browser.close()
  console.log(`\n${pass}/${total} 通过`)
  process.exit(pass === total ? 0 : 1)
}

main()
