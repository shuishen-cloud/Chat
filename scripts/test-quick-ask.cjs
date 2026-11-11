const { runAll } = require("./test-harness.cjs")

/**
 * 全部用例。浏览器只启动一次，用例间只清存储后 reload。
 * 单独跑某例：CASE=名字 node scripts/test-quick-ask.cjs
 */
const cases = {
  async regressionSameMessage(t) {
    await t.seed()
    await t.selectIn("m2")
    await t.page.locator("[data-qa='bubble']").getByRole("button", { name: /追问/ }).click()
    await t.settle()
    t.eq(await t.count("[data-qa='window']"), 1, "第一个窗口已打开")

    // 在同一消息里选另一段文字
    const picked = await t.page.evaluate(() => {
      const holder = document.querySelector("[data-message-id='m2']")
      const nodes = []
      const w = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
      let n
      while ((n = w.nextNode())) if (n.textContent.trim().length > 4) nodes.push(n)
      if (nodes.length < 2) return null
      const node = nodes[1]
      const r = document.createRange()
      r.setStart(node, 0)
      r.setEnd(node, Math.min(8, node.textContent.length))
      const s = window.getSelection()
      s.removeAllRanges()
      s.addRange(r)
      document.dispatchEvent(new Event("selectionchange"))
      return node.textContent.slice(0, 12)
    })
    t.ok(picked, "找到同消息内的第二段文字")
    await t.settle()
    t.eq(await t.count("[data-qa='bubble']"), 1, "同消息另选文字仍弹出气泡")
    t.eq(await t.count("[data-qa='window']"), 1, "原窗口保留")
  },
  async regressionFavoritesPanel(t) {
    await t.seed({
      projects: [{ id: "p1", name: "前端", createdAt: 1 }],
      conversations: [
        {
          id: "c1",
          projectId: "p1",
          title: "对话A",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "这是第一段内容，用来测试选区功能。",
              createdAt: 1,
            },
          ],
        },
      ],
      favorites: [
        { id: "f1", conversationId: "c1", messageId: "a1", tagIds: [], createdAt: 2 },
      ],
      tags: [],
      activeProjectId: "p1",
      activeConversationId: "c1",
      apiKey: "sk-t",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      sidebarView: "list",
    })

    await t.selectIn("a1")
    await t.page.locator("[data-qa='bubble']").getByRole("button", { name: /追问/ }).click()
    await t.settle()

    // 打开收藏面板
    const entry = t.page.locator("aside button").filter({ hasText: /^收藏/ }).first()
    let b = await entry.boundingBox()
    await t.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await t.settle()
    t.eq(await t.count("[data-qa='window']"), 1, "打开收藏面板后窗口仍在")

    // 点面板内空白
    const panel = t.page.locator("[data-aux-panel='favorites']").first()
    b = await panel.boundingBox()
    await t.page.mouse.click(b.x + b.width / 2, b.y + b.height - 60)
    await t.settle()
    t.eq(await t.count("[data-qa='window']"), 1, "点收藏面板空白后窗口仍在")
  },
  async mainCase(t) {
  await t.mockReply("**回答**：Zustand 更轻量。\n\n- 无样板\n- 支持中间件")
  await t.seed()

  // ---------- 1. 气泡出现 ----------
  await t.selectIn("m2")
  t.ok((await t.count("div.fixed.z-50")) > 0, "选中后气泡出现")

  // ---------- 2. 点追问 → 展开悬浮窗 ----------
  await t.clickInFloat(/追问/)
  await t.ok(
    await t.until(async () => (await t.count("div.fixed.z-50.overflow-hidden")) === 1),
    "展开为一个悬浮窗"
  )

  // ---------- 3. 打开收藏面板，悬浮窗不消失 ----------
  await t.page.locator("aside").first().getByRole("button", { name: /^收藏$/ }).click()
  await t.settle()
  t.eq(await t.count("div.fixed.z-50.overflow-hidden"), 1, "打开收藏面板后悬浮窗仍在")

  // 关闭收藏面板
  await t.page.keyboard.press("Escape")
  await t.settle()

  // ---------- 4. 多悬浮窗 ----------
  await t.selectIn("m1", 120)
  t.ok((await t.count("div.fixed.z-50")) > 0, "第二个选区出现气泡")
  await t.clickInFloat(/追问/)
  t.ok(
    await t.until(async () => (await t.count("div.fixed.z-50.overflow-hidden")) === 2),
    "存在两个悬浮窗"
  )

  // 位置不重合
  const boxes = await t.page.locator("div.fixed.z-50.overflow-hidden").evaluateAll(
    els => els.map(e => { const r = e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y)} })
  )
  t.ok(boxes[0].x !== boxes[1].x || boxes[0].y !== boxes[1].y, `两窗口错开 ${JSON.stringify(boxes)}`)

  // ---------- 5. 各自独立提问 ----------
  const wins = t.page.locator("div.fixed.z-50.overflow-hidden")
  await wins.nth(0).locator("textarea").fill("第一个问题")
  await wins.nth(0).locator("textarea").press("Enter")
  await t.ok(await t.until(async () => (await wins.nth(0).locator("strong").count()) > 0), "窗口1 有 Markdown 回答")
  t.eq(await wins.nth(1).locator("strong").count(), 0, "窗口2 不受影响")

  await wins.nth(1).locator("textarea").fill("第二个问题")
  await wins.nth(1).locator("textarea").press("Enter")
  await t.ok(await t.until(async () => (await wins.nth(1).locator("strong").count()) > 0), "窗口2 也有回答")

  await t.shot("multi")

  // ---------- 6. 关闭其一，另一个保留 ----------
  // 关闭按钮是标题栏最后一个（X）
  await wins.nth(0).locator("div.cursor-grab button").last().click()
  await t.until(async () => (await t.count("div.fixed.z-50.overflow-hidden")) === 1)
    t.eq(await t.count("div.fixed.z-50.overflow-hidden"), 1, "关闭一个后剩一个")
  },
  async asConversationCase(t) {
    await t.mockReply("**回答**：测试内容。")
    await t.seed()

    await t.selectIn("m2")
    await t.page.locator("[data-qa='bubble']").getByRole("button", { name: /追问/ }).click()
    await t.settle()
    const win = t.page.locator("[data-qa='window']")
    await win.locator("textarea").fill("浮窗提出的问题")
    await win.locator("textarea").press("Enter")
    await t.settle()

    await win.getByRole("button", { name: /展开为对话/ }).click()
    await t.untilCount("[data-qa='window']", 0)
    await t.stateUntil((s) => s.conversations.length === 2, 3000, "生成正式对话")
    await t.until(async () => (await t.page.locator("main").innerText()).includes("浮窗提出的问题"))
    t.ok(true, "主界面显示内容")

    await t.page.getByRole("button", { name: "回到原对话" }).click()
    await t.stateUntil((s) => s.activeConversationId === "c1", 3000, "返回原对话")
    t.ok(true, "返回原对话")

    // 主界面提问也进历史
    await t.page.locator("main textarea").last().fill("主界面的问题")
    await t.page.locator("main textarea").last().press("Enter")
    await t.stateUntil(
      (s) => (s.conversations.find((c) => c.id === "c1")?.messages.length ?? 0) >= 4,
      3000,
      "主界面提问已写入"
    )

    // 历史面板
    await t.page.locator("button[title^='「'], button[title='提示词历史']").first().click()
    await t.untilVisible("[data-aux-panel='prompt-history']")
    const panel = t.page.locator("[data-aux-panel='prompt-history']")
    const text = await panel.innerText()
    t.ok(text.includes("浮窗提出的问题"), "历史含浮窗提问")
    t.ok(text.includes("主界面的问题"), "历史含主界面提问")

    await panel.getByText("浮窗提出的问题").first().click()
    await t.settle()
    t.eq(
      await t.page.locator("main textarea").last().inputValue(),
      "浮窗提出的问题",
      "点击历史项填入输入框"
    )
  },
  async switcherCase(t) {
    await t.seed({
      projects: [{ id: "p1", name: "前端", createdAt: 1 }],
      conversations: [
        { id: "c1", projectId: "p1", title: "第一个对话", createdAt: 1, updatedAt: 3,
          messages: [{ id: "a1", role: "assistant", content: "内容一", createdAt: 1 }] },
        { id: "c2", projectId: "p1", title: "第二个对话", createdAt: 1, updatedAt: 2,
          messages: [{ id: "b1", role: "assistant", content: "内容二", createdAt: 1 }] },
        { id: "c3", projectId: "p1", title: "关于 React 的讨论", createdAt: 1, updatedAt: 1,
          messages: [{ id: "d1", role: "assistant", content: "React 内容", createdAt: 1 }] },
      ],
      favorites: [], tags: [], activeProjectId: "p1", activeConversationId: "c1",
      apiKey: "sk-t", baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro", sidebarView: "list",
    })

    const trigger = t.page.locator("main button[title='切换对话']")
    t.ok((await trigger.count()) > 0, "顶栏有切换器")
    await trigger.click()
    await t.settle()
    t.ok(
      (await t.page.locator("[role=menu] button").allTextContents()).some((x) =>
        x.includes("第一个对话")
      ),
      "列出对话"
    )

    const inp = t.page.getByPlaceholder("搜索对话", { exact: true })
    await inp.fill("React")
    await t.settle()
    await inp.press("Enter")
    await t.stateUntil((s) => s.activeConversationId === "c3", 3000, "切换到目标对话")
    t.ok(true, "回车切换到目标对话")
    t.ok((await trigger.innerText()).includes("关于 React"), "标题已更新")
  },
  async historyPerConversationCase(t) {
    await t.mockReply("**回答**。")
    await t.seed({
      projects: [{ id: "p1", name: "前端", createdAt: 1 }],
      conversations: [
        { id: "c1", projectId: "p1", title: "对话一", createdAt: 1, updatedAt: 3,
          messages: [{ id: "a1", role: "assistant", content: "对话一的内容段落。", createdAt: 1 }] },
        { id: "c2", projectId: "p1", title: "对话二", createdAt: 1, updatedAt: 2,
          messages: [{ id: "b1", role: "assistant", content: "对话二的内容段落。", createdAt: 1 }] },
      ],
      favorites: [], tags: [], activeProjectId: "p1", activeConversationId: "c1",
      apiKey: "sk-t", baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro", sidebarView: "list",
    })

    const ask = async (text) => {
      const ta = t.page.locator("main textarea").last()
      await ta.fill(text)
      await ta.press("Enter")
      // 等消息落盘
      await t.until(async () => {
        const raw = await t.page.evaluate(() =>
          localStorage.getItem("shadcn-chat/prompt-history/v2")
        )
        return !!raw && raw.includes(text)
      }, 3000)
    }
    const openPanel = async () => {
      await t.page.locator("button[title^='「'], button[title='提示词历史']").first().click()
      await t.untilVisible("[data-aux-panel='prompt-history']")
      await t.settle()
      return t.page.locator("[data-aux-panel='prompt-history']")
    }

    await ask("对话一的问题")
    let panel = await openPanel()
    t.ok((await panel.innerText()).includes("对话一的问题"), "对话一有自己的历史")
    await t.page.keyboard.press("Escape")
    await t.settle()

    await t.page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
      s.activeConversationId = "c2"
      localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s))
    })
    await t.page.reload({ waitUntil: "domcontentloaded" })
    await t.page.waitForTimeout(150)

    panel = await openPanel()
    t.ok(!(await panel.innerText()).includes("对话一的问题"), "对话二看不到对话一的历史")

    const stored = await t.page.evaluate(() =>
      JSON.parse(localStorage.getItem("shadcn-chat/prompt-history/v2") || "{}")
    )
    t.eq(stored.c1?.length, 1, "按对话分别存储")
  },
  async historyAutoCase(t) {
    await t.seed({
      projects: [{ id: "p1", name: "前端", createdAt: 1 }],
      conversations: [
        {
          id: "c1", projectId: "p1", title: "老对话", createdAt: 1, updatedAt: 1,
          messages: [
            { id: "u1", role: "user", content: "历史问题一", createdAt: 1_700_000_000_000 },
            { id: "a1", role: "assistant", content: "回答一", createdAt: 1_700_000_001_000 },
            { id: "u2", role: "user", content: "历史问题二", createdAt: 1_700_000_002_000 },
            { id: "a2", role: "assistant", content: "回答二", createdAt: 1_700_000_003_000 },
          ],
        },
      ],
      favorites: [], tags: [], activeProjectId: "p1", activeConversationId: "c1",
      apiKey: "sk-t", baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro", sidebarView: "list",
    })

    // 无任何历史记录时，应能从消息自动读出
    await t.page.locator("button[title^='「']").first().click()
    await t.untilVisible("[data-aux-panel='prompt-history']")
    const panel = t.page.locator("[data-aux-panel='prompt-history']")
    let txt = await panel.innerText()
    if (!(txt.includes("历史问题一") && txt.includes("历史问题二"))) {
      console.log("   [诊断] 面板内容:", txt.replace(/\n+/g, " | "))
    }
    t.ok(txt.includes("历史问题一") && txt.includes("历史问题二"), "从消息自动回读历史")
    t.eq(await panel.locator("div.group\\/ph").count(), 2, "无重复")
    await t.page.keyboard.press("Escape")
    await t.settle()

    // 旧版全局历史迁移
    await t.page.evaluate(() => {
      localStorage.removeItem("shadcn-chat/prompt-history/v2")
      localStorage.setItem(
        "shadcn-chat/prompt-history/v1",
        JSON.stringify([
          { id: "old1", text: "迁移问题A", usedAt: 1_700_000_000_500 },
        ])
      )
    })
    await t.page.reload({ waitUntil: "domcontentloaded" })
    await t.page.locator("aside").first().waitFor({ state: "visible" })
    await t.page.locator("button[title^='「']").first().click()
    await t.untilVisible("[data-aux-panel='prompt-history']")
    await t.until(async () => (await panel.innerText()).includes("迁移问题A"), 3000)
    txt = await panel.innerText()
    t.ok(txt.includes("迁移问题A"), "旧版历史已迁移")
    t.eq(
      await t.page.evaluate(() => localStorage.getItem("shadcn-chat/prompt-history/v1")),
      null,
      "迁移后清理旧键"
    )
  },
  async scrollbarThemeCase(t) {
    await t.seed()
    await t.page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
      s.conversations[0].messages = Array.from({ length: 30 }, (_, i) => ({
        id: "x" + i,
        role: i % 2 ? "assistant" : "user",
        content: "第 " + i + " 条测试消息，用于撑出滚动条。",
        createdAt: Date.now(),
      }))
      localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s))
      localStorage.setItem("shadcn-chat/theme", "dark")
    })
    await t.page.reload({ waitUntil: "domcontentloaded" })
    await t.settle()

    const dark = await t.page.evaluate(() => {
      const el = document.querySelector("main .overflow-y-auto")
      const root = getComputedStyle(document.documentElement)
      return {
        color: getComputedStyle(el).scrollbarColor,
        border: root.getPropertyValue("--border").trim(),
      }
    })
    t.ok(
      dark.color.includes(dark.border.split(" ")[0]) ||
        dark.color !== "auto",
      "暗色滚动条使用主题色"
    )

    await t.page.evaluate(() => localStorage.setItem("shadcn-chat/theme", "light"))
    await t.page.reload({ waitUntil: "domcontentloaded" })
    await t.settle()
    const light = await t.page.evaluate(
      () => getComputedStyle(document.querySelector("main .overflow-y-auto")).scrollbarColor
    )
    t.ok(light !== dark.color, "亮/暗滚动条颜色不同")
  },
  async favoriteJumpCase(t) {
    await t.mockReply("**Zustand** 更轻量。")
    await t.seed({
      projects: [
        { id: "p1", name: "项目A", createdAt: 1 },
        { id: "p2", name: "项目B", createdAt: 1 },
      ],
      conversations: [
        { id: "c1", projectId: "p1", title: "A-旧对话", createdAt: 1, updatedAt: 1,
          messages: [{ id: "m1", role: "assistant", content: "A项目旧对话的内容段落。", createdAt: 1 }] },
        { id: "c2", projectId: "p1", title: "A-新对话", createdAt: 1, updatedAt: 9,
          messages: [{ id: "m2", role: "assistant", content: "A项目新对话的内容段落。", createdAt: 1 }] },
        { id: "c3", projectId: "p2", title: "B-对话", createdAt: 1, updatedAt: 5,
          messages: [{ id: "m3", role: "assistant", content: "B项目的内容段落。", createdAt: 1 }] },
      ],
      favorites: [
        { id: "f1", conversationId: "c1", messageId: "m1", tagIds: [], createdAt: 3 },
        { id: "f2", conversationId: "c3", messageId: "m3", tagIds: [], createdAt: 2 },
      ],
      tags: [], activeProjectId: "p1", activeConversationId: "c2",
      apiKey: "sk-t", baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro", sidebarView: "list",
    })

    const panel = t.page.locator("[data-aux-panel='favorites']")
    const openFav = async () => {
      await t.page.locator("aside button").filter({ hasText: /^收藏/ }).first().click()
      await t.settle()
    }

    // 同项目内跨对话：不能落到项目默认（最新）对话 c2
    await openFav()
    await panel.getByText("A项目旧对话的内容段落").first().click()
    await t.stateUntil((s) => s.activeConversationId === "c1", 3000, "跳转到指定对话")
    t.ok(true, "跳转到指定对话")

    // 跨项目
    await openFav()
    await panel.getByText("B项目的内容段落").first().click()
    const st = await t.stateUntil(
      (s) => s.activeConversationId === "c3",
      3000,
      "跨项目跳转"
    )
    t.eq(st.activeProjectId, "p2", "跨项目：项目已切换")
    t.eq(st.activeConversationId, "c3", "跨项目：对话正确")
  },
  async historyNoDeleteCase(t) {
    await t.seed({
      projects: [{ id: "p1", name: "前端", createdAt: 1 }],
      conversations: [
        { id: "c1", projectId: "p1", title: "对话", createdAt: 1, updatedAt: 1,
          messages: [
            { id: "u1", role: "user", content: "历史提问一", createdAt: 1_700_000_000_000 },
            { id: "a1", role: "assistant", content: "回答一", createdAt: 1_700_000_001_000 },
          ] },
      ],
      favorites: [], tags: [], activeProjectId: "p1", activeConversationId: "c1",
      apiKey: "sk-t", baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro", sidebarView: "list",
    })

    await t.page.locator("button[title^='「']").first().click()
    await t.untilVisible("[data-aux-panel='prompt-history']")
    const panel = t.page.locator("[data-aux-panel='prompt-history']")
    const btns = await panel
      .locator("button")
      .evaluateAll((els) => els.map((e) => e.getAttribute("title")))

    t.ok(!btns.includes("删除"), "没有单条删除")
    t.ok(!btns.some((x) => x && x.includes("清空")), "没有清空按钮")
    t.ok(btns.includes("复制"), "保留复制")
  },
  async freshSendCase(t) {
    await t.mockReply("**收到**。")
    // 完全空白起步：只有一个空对话，模拟首次使用
    await t.seed({
      projects: [{ id: "p1", name: "我的项目", createdAt: 1 }],
      conversations: [
        { id: "c1", projectId: "p1", title: "新对话", createdAt: 1, updatedAt: 1,
          messages: [] },
      ],
      favorites: [], tags: [], activeProjectId: "p1",
      activeConversationId: "c1", apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro",
      sidebarView: "list",
    })

    for (const [i, msg] of ["第一条", "第二条"].entries()) {
      const ta = t.page.locator("main textarea").last()
      await ta.fill(msg)
      await ta.press("Enter")
      await t.stateUntil(
        (s) => (s.conversations[0]?.messages.length ?? 0) >= (i + 1) * 2,
        3000,
        `第 ${i + 1} 条已写入`
      )
    }

    const st = await t.state()
    t.eq(st.conversations.length, 1, "未额外新建对话")
    t.eq(st.activeConversationId, "c1", "仍停留在当前对话")
    const conv = st.conversations[0]
    t.eq(conv.messages.length, 4, "两条问答都写入当前对话")
    t.ok(conv.title !== "新对话", "标题已按首条消息更新")
  },
}

const only = process.env.CASE
if (only === "--list") {
  console.log("可用用例:\n  " + Object.keys(cases).join("\n  "))
  process.exit(0)
}
if (only && !cases[only]) {
  console.error(`未知用例: ${only}\n可用: ${Object.keys(cases).join(", ")}`)
  process.exit(1)
}
runAll(cases, only ? { only } : {})
