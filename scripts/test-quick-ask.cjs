const { run } = require("./test-harness.cjs")

/** 主用例：气泡 / 展开 / 多窗共存 / 独立性 / 关闭 */
function mainCase() {
  return run(async (t) => {
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
  await t.page.waitForTimeout(300)
  t.eq(await t.count("div.fixed.z-50.overflow-hidden"), 1, "打开收藏面板后悬浮窗仍在")

  // 关闭收藏面板
  await t.page.keyboard.press("Escape")
  await t.page.waitForTimeout(200)

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
  })
}

/** 回归：开启第一个浮窗后，在同一消息的另一段文字上仍能弹出追问气泡 */
function regressionSameMessage() {
  const { run } = require("./test-harness.cjs")
  return run(async (t) => {
    await t.seed()
    await t.selectIn("m2")
    await t.page.locator("[data-qa='bubble']").getByRole("button", { name: /追问/ }).click()
    await t.page.waitForTimeout(300)
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
    await t.page.waitForTimeout(300)
    t.eq(await t.count("[data-qa='bubble']"), 1, "同消息另选文字仍弹出气泡")
    t.eq(await t.count("[data-qa='window']"), 1, "原窗口保留")
  })
}



/** 回归：收藏面板打开后，在面板内操作不应关闭悬浮窗 */
function regressionFavoritesPanel() {
  const { run } = require("./test-harness.cjs")
  return run(async (t) => {
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
    await t.page.waitForTimeout(300)

    // 打开收藏面板
    const entry = t.page.locator("aside button").filter({ hasText: /^收藏/ }).first()
    let b = await entry.boundingBox()
    await t.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await t.page.waitForTimeout(400)
    t.eq(await t.count("[data-qa='window']"), 1, "打开收藏面板后窗口仍在")

    // 点面板内空白
    const panel = t.page.locator("[data-aux-panel='favorites']").first()
    b = await panel.boundingBox()
    await t.page.mouse.click(b.x + b.width / 2, b.y + b.height - 60)
    await t.page.waitForTimeout(300)
    t.eq(await t.count("[data-qa='window']"), 1, "点收藏面板空白后窗口仍在")
  })
}

/** 浮窗展开为正式对话 + 返回原对话 + 提示词历史 */
function asConversationCase() {
  return run(async (t) => {
    await t.mockReply("**回答**：测试内容。")
    await t.seed()

    await t.selectIn("m2")
    await t.page.locator("[data-qa='bubble']").getByRole("button", { name: /追问/ }).click()
    await t.page.waitForTimeout(300)
    const win = t.page.locator("[data-qa='window']")
    await win.locator("textarea").fill("浮窗提出的问题")
    await win.locator("textarea").press("Enter")
    await t.page.waitForTimeout(800)

    await win.getByRole("button", { name: /展开为对话/ }).click()
    await t.page.waitForTimeout(600)
    t.eq(await t.count("[data-qa='window']"), 0, "浮窗关闭")
    t.eq((await t.state()).conversations.length, 2, "生成正式对话")
    t.ok((await t.page.locator("main").innerText()).includes("浮窗提出的问题"), "主界面显示内容")

    await t.page.getByRole("button", { name: "回到原对话" }).click()
    await t.page.waitForTimeout(400)
    t.eq((await t.state()).activeConversationId, "c1", "返回原对话")

    // 主界面提问也进历史
    await t.page.locator("main textarea").last().fill("主界面的问题")
    await t.page.locator("main textarea").last().press("Enter")
    await t.page.waitForTimeout(600)

    // 历史面板
    await t.page.locator("button[title='提示词历史']").click()
    await t.page.waitForTimeout(400)
    const panel = t.page.locator("[data-aux-panel='prompt-history']")
    const text = await panel.innerText()
    t.ok(text.includes("浮窗提出的问题"), "历史含浮窗提问")
    t.ok(text.includes("主界面的问题"), "历史含主界面提问")

    await panel.getByText("浮窗提出的问题").first().click()
    await t.page.waitForTimeout(400)
    t.eq(
      await t.page.locator("main textarea").last().inputValue(),
      "浮窗提出的问题",
      "点击历史项填入输入框"
    )
  })
}

if (require.main === module) {
  const cases = {
    main: mainCase,
    regression: regressionSameMessage,
    favorites: regressionFavoritesPanel,
    asconversation: asConversationCase,
  }
  const pick = process.env.CASE || "main"
  const fn = cases[pick]
  if (!fn) {
    console.error(`未知用例: ${pick}，可选 ${Object.keys(cases).join(" / ")}`)
    process.exit(1)
  }
  fn()
}
