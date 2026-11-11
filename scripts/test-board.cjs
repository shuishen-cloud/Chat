/**
 * 画板功能用例。
 *   npm run dev            # 另开一个终端
 *   node scripts/test-board.cjs
 *   CASE=addFromMessage node scripts/test-board.cjs
 *   CASE=--list node scripts/test-board.cjs
 */
const { runAll, defaultSeed, URL } = require("./test-harness.cjs")

/** 在默认种子上补一个空画板 */
function seedWithBoard(extra = {}) {
  const now = Date.now()
  const s = defaultSeed()
  return {
    ...s,
    boards: [{ id: "b1", projectId: null, name: "思路板", createdAt: now, updatedAt: now }],
    boardNodes: [],
    boardEdges: [],
    activeBoardId: "b1",
    mainView: "chat",
    ...extra,
  }
}

const cases = {
  /** 从消息动作条加入画板，节点落库且自动切到画板视图 */
  async addFromMessage(t) {
    await t.seed(seedWithBoard())

    // 消息气泡动作条里的「加入画板」
    await t.page
      .locator("[data-message-id='m2']")
      .getByRole("button", { name: "加入画板" })
      .click()

    const s = await t.stateUntil((x) => x.boardNodes.length === 1, 3000, "节点落库")
    t.eq(s.boardNodes[0].ref, { conversationId: "c1", messageId: "m2" }, "节点引用正确")
    t.eq(s.boardNodes[0].kind, "message", "节点类型为 message")

    // 切到画板后应能渲染出卡片
    await t.openBoard()
    await t.untilVisible(".react-flow__node")
    t.eq(await t.count(".react-flow__node"), 1, "画布渲染 1 个节点")
  },

  /** 重复加入不产生重复节点 */
  async dedupe(t) {
    await t.seed(seedWithBoard())
    const btn = () =>
      t.page.locator("[data-message-id='m2']").getByRole("button", { name: "加入画板" })

    await btn().click()
    await t.untilState((s) => s.boardNodes.length === 1)
    await btn().click()
    // 第二次点击应提示「已在画板上」，节点数保持 1
    await t.page.waitForTimeout(300)
    const s = await t.state()
    t.eq(s.boardNodes.length, 1, "未重复创建节点")
  },

  /** 整条对话铺入：N 条消息 = N 个节点 + N-1 条 reference 边 */
  async wholeConversation(t) {
    await t.seed(seedWithBoard())
    await t.openBoard()
    // 空画板不渲染 .react-flow（显示空状态），先等工具条出现
    await t.page.getByRole("button", { name: "新建便签" }).waitFor({ state: "visible" })
    await t.page.getByRole("button", { name: "当前对话全部加入" }).click()

    const s = await t.stateUntil((x) => x.boardNodes.length === 2, 3000, "铺入 2 条消息")
    t.eq(s.boardNodes.length, 2, "节点数 = 消息数")
    t.eq(s.boardEdges.length, 1, "相邻消息自动连 reference 边")
    t.eq(s.boardEdges[0].kind, "reference", "边类型为 reference")

    // 再点一次不应新增
    await t.page.getByRole("button", { name: "当前对话全部加入" }).click()
    await t.page.waitForTimeout(300)
    t.eq((await t.state()).boardNodes.length, 2, "重复铺入不新增")
  },

  /** 便签编辑写入 note */
  async editNote(t) {
    await t.seed(seedWithBoard())
    await t.openBoard()
    await t.page.getByRole("button", { name: "新建便签" }).waitFor({ state: "visible" })
    await t.page.getByRole("button", { name: "新建便签" }).click()
    await t.untilState((s) => s.boardNodes.length === 1)

    const ta = t.page.locator(".react-flow__node textarea")
    await ta.waitFor({ state: "visible" })
    await ta.fill("先把方案列成三类")
    await t.untilState(
      (s) => s.boardNodes[0]?.note === "先把方案列成三类",
      3000
    )
    t.eq((await t.state()).boardNodes[0].kind, "note", "便签类型正确")
  },

  /** 拖拽后坐标写回 store（只在 dragStop 提交一次） */
  async dragPersistsPosition(t) {
    await t.seed(seedWithBoard())
    await t.openBoard()
    // 空画板不渲染 .react-flow（显示空状态），先等工具条出现
    await t.page.getByRole("button", { name: "新建便签" }).waitFor({ state: "visible" })
    await t.page.getByRole("button", { name: "当前对话全部加入" }).click()
    await t.untilState((s) => s.boardNodes.length === 2)

    const before = (await t.state()).boardNodes[0]
    const node = t.page.locator(`.react-flow__node[data-id='${before.id}']`)
    const box = await node.boundingBox()

    await t.page.mouse.move(box.x + 60, box.y + 12)
    await t.page.mouse.down()
    await t.page.mouse.move(box.x + 160, box.y + 92, { steps: 6 })
    await t.page.mouse.up()

    const expected = await t.stateUntil(
      (s) => {
        const n = s.boardNodes.find((x) => x.id === before.id)
        return n && Math.abs(n.x - before.x) > 40
      },
      3000,
      "坐标写回"
    )
    const after = expected.boardNodes.find((x) => x.id === before.id)
    t.ok(after.y > before.y, "纵向也发生了移动")
  },

  /** 删除对话后，画板上的悬空引用被清理 */
  async gcOnConversationDelete(t) {
    await t.seed(
      seedWithBoard({
        boardNodes: [
          {
            id: "n1",
            boardId: "b1",
            kind: "message",
            ref: { conversationId: "c1", messageId: "m2" },
            x: 0,
            y: 0,
            createdAt: Date.now(),
          },
        ],
      })
    )
    t.eq(await t.count(".react-flow__node"), 0, "初始在对话视图，画布未渲染")

    // 通过侧边栏菜单删除对话
    await t.seed(
      seedWithBoard({
        boardNodes: [
          {
            id: "n1",
            boardId: "b1",
            kind: "message",
            ref: { conversationId: "c1", messageId: "m2" },
            x: 0,
            y: 0,
            createdAt: Date.now(),
          },
        ],
      })
    )
    await t.page.evaluate(() => {
      // 直接验证持久化层：删除对话后 reload，加载时会 gc 悬空引用
      const raw = JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
      raw.conversations = []
      raw.activeConversationId = null
      localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(raw))
    })
    await t.page.reload({ waitUntil: "domcontentloaded" })
    await t.page.locator("aside").first().waitFor({ state: "visible" })
    const s = await t.stateUntil((x) => x.boardNodes.length === 0, 3000, "悬空节点被清理")
    t.eq(s.boardNodes.length, 0, "加载时 gc 掉悬空节点")
  },

  /** 无画板时从消息加入会自动建板 */
  async autoCreateBoard(t) {
    const s0 = defaultSeed()
    await t.seed({ ...s0, boards: [], activeBoardId: null, mainView: "chat" })

    await t.page
      .locator("[data-message-id='m1']")
      .getByRole("button", { name: "加入画板" })
      .click()

    const s = await t.stateUntil((x) => x.boardNodes.length === 1, 3000, "自动建板")
    t.eq(s.boards.length, 1, "自动创建 1 个画板")
    t.eq(s.boardNodes[0].boardId, s.boards[0].id, "节点归属新画板")
    t.eq(s.boardNodes[0].ref.messageId, "m1", "引用的是点击的那条消息")
  },
}

/* ---------------- 回归用例 ---------------- */

/** 两个画板的种子数据，用于验证切换 */
function seedTwoBoards() {
  const now = Date.now()
  return seedWithBoard({
    boards: [
      { id: "b1", projectId: null, name: "板A", createdAt: now, updatedAt: now },
      { id: "b2", projectId: null, name: "板B", createdAt: now - 10, updatedAt: now - 10 },
    ],
    boardNodes: [
      {
        id: "n1",
        boardId: "b1",
        kind: "message",
        ref: { conversationId: "c1", messageId: "m2" },
        x: 0,
        y: 0,
        createdAt: now,
      },
      {
        id: "n2",
        boardId: "b1",
        kind: "message",
        ref: { conversationId: "c1", messageId: "m1" },
        x: 400,
        y: 0,
        createdAt: now,
      },
    ],
    activeBoardId: "b1",
    mainView: "board",
  })
}

cases.switchBoard = async (t) => {
  await t.seed(seedTwoBoards())
  await t.untilVisible(".react-flow__node")
  t.eq(await t.count(".react-flow__node"), 2, "板A 有 2 张卡片")

  // 切换到空画板板B
  await t.page.getByRole("button", { name: "切换画板" }).click()
  await t.page.getByRole("menuitem", { name: "板B" }).click()
  await t.page.waitForTimeout(400)

  const s = await t.stateUntil((x) => x.activeBoardId === "b2", 3000, "切到板B")
  t.eq(s.activeBoardId, "b2", "activeBoardId 已切换")
  t.eq(await t.count(".react-flow__node"), 0, "板B 为空，无卡片")
  t.ok(
    await t.page.getByText("画板还是空的").isVisible(),
    "空画板显示空状态"
  )

  // 再切回板A，卡片回来
  await t.page.getByRole("button", { name: "切换画板" }).click()
  await t.page.getByRole("menuitem", { name: "板A" }).click()
  await t.page.waitForTimeout(400)
  t.eq(await t.count(".react-flow__node"), 2, "切回板A 恢复 2 张卡片")
}

cases.dragFollowsPointerMidway = async (t) => {
  await t.seed(seedTwoBoards())
  await t.untilVisible(".react-flow__node")

  const first = () =>
    t.page.locator(`.react-flow__node[data-id='n2']`)
  const box = await first().boundingBox()
  const startX = box.x
  const startY = box.y

  await t.page.mouse.move(box.x + 50, box.y + 10)
  await t.page.mouse.down()
  // 分步移动，中途检查卡片是否已跟着走（而不是松手才跳）
  await t.page.mouse.move(box.x + 130, box.y + 90, { steps: 8 })
  const mid = await first().boundingBox()
  t.ok(mid.x - startX > 40, `拖拽中途卡片已跟随 (Δx=${Math.round(mid.x - startX)})`)
  t.ok(mid.y - startY > 40, `拖拽中途纵向也跟随 (Δy=${Math.round(mid.y - startY)})`)

  await t.page.mouse.up()
  await t.stateUntil(
    (s) => {
      const n = s.boardNodes.find((x) => x.id === "n2")
      return n && n.x > 40
    },
    3000,
    "松手后坐标落库"
  )
}

cases.resizePersists = async (t) => {
  await t.seed(seedTwoBoards())
  await t.untilVisible(".react-flow__node[data-id='n2']")

  const node = t.page.locator(`.react-flow__node[data-id='n2']`)
  // 单击选中才会显示 resizer
  await node.click()
  await t.page.waitForTimeout(200)

  const handles = t.page.locator(
    ".react-flow__node[data-id='n2'] .react-flow__resize-control.bottom.right"
  )
  t.ok((await handles.count()) > 0, "选中后出现缩放手柄")

  const hb = await handles.first().boundingBox()
  await t.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await t.page.mouse.down()
  await t.page.mouse.move(hb.x + 120, hb.y + 80, { steps: 8 })
  await t.page.mouse.up()

  const s = await t.stateUntil(
    (x) => {
      const n = x.boardNodes.find((n) => n.id === "n2")
      return n && n.width && n.width > 300
    },
    3000,
    "尺寸落库"
  )
  const n = s.boardNodes.find((x) => x.id === "n2")
  t.ok(n.height > 100, `高度也被保存 (${n.height})`)
}

cases.jumpBackToMessage = async (t) => {
  await t.seed(seedTwoBoards())
  await t.untilVisible(".react-flow__node[data-id='n1']")

  // 点击卡片上的「回到原消息」
  await t.page
    .locator(".react-flow__node[data-id='n1']")
    .getByTitle("回到原消息")
    .click()

  const s = await t.stateUntil((x) => x.mainView === "chat", 3000, "切回对话视图")
  t.eq(s.mainView, "chat", "视图已切回对话")
  t.eq(s.activeConversationId, "c1", "定位到正确对话")

  // 对应消息应该被高亮（scrollMessageIntoView 的视觉反馈）
  const flashed = await t.until(async () => {
    return (
      (await t.count("[data-message-id='m2'].msg-flash")) === 1
    )
  }, 3000)
  t.ok(flashed, "目标消息已高亮定位")
}

/** 连线应为曲线（贝塞尔），而非折线 smoothstep */
cases.edgesAreCurves = async (t) => {
  // 用空画板：铺入整条对话才会自动生成 reference 边
  await t.seed(seedWithBoard({ mainView: "board" }))
  await t.page.getByRole("button", { name: "当前对话全部加入" }).waitFor({ state: "visible" })
  await t.page.getByRole("button", { name: "当前对话全部加入" }).click()
  await t.untilState((s) => s.boardEdges.length > 0, 3000, "生成连线")

  const paths = t.page.locator(".react-flow__edge-path")
  t.ok((await paths.count()) > 0, "存在连线")

  // 判据：曲线路径里会出现 C（三次贝塞尔）命令；折线 smoothstep 只有 L
  const d = await paths.first().getAttribute("d")
  t.ok(/C/.test(d), `连线是曲线（d 含 C 命令）: ${d.slice(0, 60)}`)
  t.ok(!/^M[^C]*L[^C]*$/.test(d), "不是纯折线")
}

/** 画板打开时仍可切换会话，不需要先关闭画板 */
cases.switchConversationWithBoardOpen = async (t) => {
  const now = Date.now()
  const base = seedTwoBoards()
  await t.seed({
    ...base,
    conversations: [
      base.conversations[0],
      {
        id: "c2",
        projectId: "p1",
        title: "第二个会话",
        createdAt: now,
        updatedAt: now - 1000,
        messages: [{ id: "x1", role: "user", content: "hello", createdAt: now }],
      },
    ],
    activeConversationId: "c1",
  })
  await t.untilVisible(".react-flow__node")

  // 画板仍在右侧时，点击侧边栏另一个会话
  await t.page.locator("aside").getByText("第二个会话").first().click()
  const s = await t.stateUntil(
    (x) => x.activeConversationId === "c2",
    3000,
    "会话已切换"
  )
  t.eq(s.activeConversationId, "c2", "会话切换成功")
  // 画板不因切换会话而关闭
  t.ok((await t.count(".react-flow__node")) > 0, "画板仍然打开并显示卡片")
}

/** 勾选多条消息，批量加入指定画板 */
cases.checkboxBatchAdd = async (t) => {
  const now = Date.now()
  const base = seedTwoBoards()
  await t.seed({
    ...base,
    // 板B 为空，用来验证「加入指定画板」
    boardNodes: base.boardNodes,
    conversations: [
      {
        ...base.conversations[0],
        messages: [
          { id: "m1", role: "user", content: "问题一", createdAt: now },
          { id: "m2", role: "assistant", content: "回答一", createdAt: now },
          { id: "m3", role: "user", content: "问题二", createdAt: now },
          { id: "m4", role: "assistant", content: "回答二", createdAt: now },
        ],
      },
    ],
    activeBoardId: "b1",
  })

  // 进入多选模式
  await t.page.getByRole("button", { name: "多选" }).click()
  await t.page.getByText("已选").waitFor({ state: "visible" })

  // 勾选第 3、4 条
  await t.page.locator("[data-message-id='m3']").click()
  await t.page.locator("[data-message-id='m4']").click()
  t.eq(await t.page.locator("text=2").first().innerText(), "2", "已选 2 条")

  // 选择目标画板 = 板B（工具条上的画板选择器，排除标题的重命名按钮）
  await t.page
    .getByRole("button", { name: "板A", description: undefined })
    .and(t.page.locator("[aria-haspopup='menu']"))
    .click()
  await t.page.getByRole("menuitem", { name: "板B" }).click()

  await t.page.getByRole("button", { name: /加入选中/ }).click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.filter((n) => n.boardId === "b2").length === 2,
    3000,
    "2 条加入板B"
  )
  const inB2 = s.boardNodes.filter((n) => n.boardId === "b2")
  t.eq(inB2.length, 2, "板B 新增 2 张卡片")
  t.eq(
    inB2.map((n) => n.ref.messageId).sort(),
    ["m3", "m4"],
    "加入的是勾选的消息"
  )
  // 板A 原有节点不受影响
  t.eq(
    s.boardNodes.filter((n) => n.boardId === "b1").length,
    2,
    "板A 未被改动"
  )
  // 批量加入后应切到目标画板
  t.eq(s.activeBoardId, "b2", "自动切到目标画板")
}

/* ---------------- 划词加入画板 ---------------- */

const STRUCT_MD = [
  "## 对比",
  "",
  "| 方案 | 体积 |",
  "| --- | --- |",
  "| Zustand | 1KB |",
  "| Redux | 12KB |",
  "",
  "```ts",
  "const a = 1",
  "  const b = 2",
  "```",
  "",
  "普通一行话。",
].join("\n")

function seedStructured() {
  const now = Date.now()
  return {
    ...defaultSeed(),
    conversations: [
      {
        id: "c1",
        projectId: "p1",
        title: "t",
        createdAt: now,
        updatedAt: now,
        messages: [{ id: "m1", role: "assistant", content: STRUCT_MD, createdAt: now }],
      },
    ],
    boards: [{ id: "b1", projectId: null, name: "板A", createdAt: now, updatedAt: now }],
    boardNodes: [],
    boardEdges: [],
    activeBoardId: "b1",
    mainView: "chat",
  }
}

/** 选区序列化：表格保持表格、代码块保留缩进 */
cases.selectionSerializesStructure = async (t) => {
  await t.seed(seedStructured())
  await t.page.locator("[data-message-id='m1']").waitFor({ state: "visible" })

  const out = await t.page.evaluate(async () => {
    const mod = await import("/src/lib/selection-to-markdown.ts")
    const holder = document.querySelector("[data-message-id='m1']")
    const grab = (el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return mod.rangeToMarkdown(r)
    }
    return {
      table: grab(holder.querySelector("table")),
      pre: grab(holder.querySelector("pre")),
      p: grab(holder.querySelector("p")),
    }
  })

  // 表格：必须是 Markdown 表格，含表头分隔行
  t.ok(out.table.includes("| 方案 | 体积 |"), "表格保留表头")
  t.ok(/\|\s*-{3,}\s*\|/.test(out.table), "表格保留分隔行")
  t.ok(out.table.includes("| Zustand | 1KB |"), "表格保留数据行")
  t.ok(!out.table.includes("\t"), "不再用 \\t 连接单元格")

  // 代码块：保留语言与缩进
  t.ok(out.pre.startsWith("```ts"), "代码块保留语言标识")
  t.ok(out.pre.includes("  const b = 2"), "代码块保留缩进")
  t.ok(out.pre.trim().endsWith("```"), "代码块正确闭合")

  // 普通段落不受影响
  t.eq(out.p, "普通一行话。", "普通段落原样保留")
}

/** 划词 → 加入指定画板 */
cases.selectionAddToBoard = async (t) => {
  const now = Date.now()
  await t.seed({
    ...seedStructured(),
    boards: [
      { id: "b1", projectId: null, name: "板A", createdAt: now, updatedAt: now },
      { id: "b2", projectId: null, name: "板B", createdAt: now, updatedAt: now - 5 },
    ],
  })
  await t.page.locator("[data-message-id='m1']").waitFor({ state: "visible" })

  // 选中表格
  await t.page.evaluate(() => {
    const holder = document.querySelector("[data-message-id='m1']")
    const table = holder.querySelector("table")
    const r = document.createRange()
    r.selectNodeContents(table)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(r)
    document.dispatchEvent(new Event("selectionchange"))
  })
  // 等气泡出现
  await t.page.locator("[data-qa='bubble']").waitFor({ state: "visible" })

  // 气泡里点「画板」→ 板B
  await t.page.locator("[data-qa='bubble']").getByRole("button", { name: "画板" }).click()
  await t.page.getByRole("menuitem", { name: "板B" }).click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.length === 1,
    3000,
    "摘录节点落库"
  )
  const node = s.boardNodes[0]
  t.eq(node.boardId, "b2", "进入了指定的板B")
  t.eq(node.ref, { conversationId: "c1", messageId: "m1" }, "保留源消息引用")
  t.ok(node.excerpt.includes("| Zustand | 1KB |"), "片段是 Markdown 表格而非 \\t 拼接")
  t.ok(!node.excerpt.includes("\t"), "片段不含 \\t")
}

/* ---------------- 连线执行 / 任务（board-flow-tasks） ---------------- */

/** 两个消息节点 + 一条 flow 边的最小种子 */
function seedFlow() {
  const now = Date.now()
  return {
    ...defaultSeed(),
    boards: [{ id: "b1", projectId: null, name: "思路板", createdAt: now, updatedAt: now }],
    boardNodes: [
      {
        id: "a",
        boardId: "b1",
        kind: "message",
        ref: { conversationId: "c1", messageId: "m1" },
        x: 0,
        y: 0,
        createdAt: now,
      },
      {
        id: "b",
        boardId: "b1",
        kind: "message",
        ref: { conversationId: "c1", messageId: "m2" },
        x: 380,
        y: 0,
        createdAt: now,
      },
    ],
    boardEdges: [
      { id: "e1", boardId: "b1", from: "a", to: "b", kind: "flow", prompt: "" },
    ],
    boardTasks: [],
    activeTaskId: null,
    activeBoardId: "b1",
    mainView: "board",
  }
}

/** 拖拽新建的连线默认是 flow 且启用 */
cases.flowEdgeDefaults = async (t) => {
  const now = Date.now()
  await t.seed({
    ...seedFlow(),
    boardEdges: [],
  })
  await t.untilVisible(".react-flow__node[data-id='a']")

  // 从 a 的底部 source 拖到 b 的顶部 target
  const src = t.page.locator(".react-flow__node[data-id='a'] .react-flow__handle.source").first()
  const dst = t.page.locator(".react-flow__node[data-id='b'] .react-flow__handle.target").first()
  const sb = await src.boundingBox()
  const db = await dst.boundingBox()
  await t.page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await t.page.mouse.down()
  await t.page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 10 })
  await t.page.mouse.up()

  const s = await t.stateUntil((x) => x.boardEdges.length === 1, 3000, "连线已创建")
  t.eq(s.boardEdges[0].kind, "flow", "新连线默认是 flow")
  t.ok(s.boardEdges[0].enabled !== false, "默认启用")
}

/** 编辑边上的提示词 */
cases.editEdgePrompt = async (t) => {
  await t.seed(seedFlow())
  await t.untilVisible(".react-flow__edge")

  // 单击边打开编辑器（点 path 而非 g，命中率更高）
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  const box = t.page.getByPlaceholder("这条线要做什么？")
  await box.waitFor({ state: "visible" })
  await box.fill("提炼成三点")
  await t.page.getByRole("button", { name: "保存" }).click()

  const s = await t.stateUntil(
    (x) => x.boardEdges[0]?.prompt === "提炼成三点",
    3000,
    "提示词已保存"
  )
  t.eq(s.boardEdges[0].prompt, "提炼成三点", "提示词持久化")
}

/** 禁用后不参与执行 */
cases.toggleEdgeEnabled = async (t) => {
  await t.seed(seedFlow())
  await t.untilVisible(".react-flow__edge")

  // 通过边菜单禁用
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.waitForTimeout(200)
  await t.page.getByRole("button", { name: /禁用此线|启用此线/ }).first().click()

  const s = await t.stateUntil(
    (x) => x.boardEdges[0]?.enabled === false,
    3000,
    "边已禁用"
  )
  t.eq(s.boardEdges[0].enabled, false, "enabled=false")
}

/** 创建任务并把边加进任务 */
cases.taskCreateAndSelectEdges = async (t) => {
  await t.seed(seedFlow())
  await t.untilVisible(".react-flow__edge")

  // 新建任务会自动进入选边模式（按钮此时显示「退出选边」）
  await t.page.getByRole("button", { name: "新建任务" }).click()
  await t.stateUntil((x) => x.boardTasks.length === 1, 3000, "任务已创建")
  await t.page.getByRole("button", { name: "退出选边" }).waitFor({ state: "visible" })

  await t.page.locator(".react-flow__edge-path").first().click({ force: true })

  const s = await t.stateUntil(
    (x) => x.boardTasks[0]?.edgeIds?.length === 1,
    3000,
    "边已加入任务"
  )
  t.eq(s.boardTasks[0].edgeIds, ["e1"], "任务记录了这条边")
}

/** 执行任务：写回终点节点内容并追加历史 */
cases.runTaskWritesHistory = async (t) => {
  const seed = seedFlow()
  seed.boardEdges[0].prompt = "改写一下"
  seed.boardTasks = [
    { id: "t1", boardId: "b1", name: "任务1", edgeIds: ["e1"], createdAt: Date.now(), updatedAt: Date.now() },
  ]
  seed.activeTaskId = "t1"
  await t.seed(seed)

  await t.mockReply("这是模型输出")
  await t.untilVisible(".react-flow__edge")
  await t.page.getByRole("button", { name: /运行任务/ }).click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.find((n) => n.id === "b")?.runs?.length === 1,
    8000,
    "运行历史已写入"
  )
  const target = s.boardNodes.find((n) => n.id === "b")
  t.eq(target.contentOverride, "这是模型输出", "结果写回终点节点内容")
  t.eq(target.runs[0].edgeId, "e1", "历史记录来源边")
  t.eq(target.runs[0].prompt, "改写一下", "历史保存提示词快照")
}

/** 节点内容可编辑 */
cases.editNodeContent = async (t) => {
  await t.seed(seedFlow())
  await t.untilVisible(".react-flow__node[data-id='b']")

  await t.page.locator(".react-flow__node[data-id='b']").getByTitle("编辑内容").click()
  const ta = t.page.locator(".react-flow__node[data-id='b'] textarea")
  await ta.waitFor({ state: "visible" })
  await ta.fill("我改过的内容")
  await t.page.locator(".react-flow__node[data-id='b']").getByTitle("保存").click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.find((n) => n.id === "b")?.contentOverride === "我改过的内容",
    3000,
    "节点内容已改写"
  )
  t.eq(
    s.boardNodes.find((n) => n.id === "b").contentOverride,
    "我改过的内容",
    "contentOverride 持久化"
  )
}

/** 还原为原文 */
cases.restoreNodeContent = async (t) => {
  const seed = seedFlow()
  seed.boardNodes[1].contentOverride = "临时改写"
  await t.seed(seed)

  await t.untilVisible(".react-flow__node[data-id='b']")
  await t.page.locator(".react-flow__node[data-id='b']").getByTitle("还原为原文").click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.find((n) => n.id === "b")?.contentOverride === undefined,
    3000,
    "已还原"
  )
  t.ok(
    s.boardNodes.find((n) => n.id === "b").contentOverride === undefined,
    "contentOverride 已清空"
  )
}

/** 多条线指向同一终点时，结果拼接而非互相覆盖 */
cases.multiEdgeConvergeKeepsAll = async (t) => {
  const now = Date.now()
  const base = seedFlow()
  await t.seed({
    ...base,
    boardNodes: [
      { id: "a", boardId: "b1", kind: "note", note: "材料A", x: 0, y: 0, createdAt: now },
      { id: "b2", boardId: "b1", kind: "note", note: "材料B", x: 0, y: 300, createdAt: now },
      { id: "d", boardId: "b1", kind: "note", note: "初始输出", x: 400, y: 150, createdAt: now },
    ],
    boardEdges: [
      { id: "e1", boardId: "b1", from: "a", to: "d", kind: "flow", prompt: "处理A" },
      { id: "e2", boardId: "b1", from: "b2", to: "d", kind: "flow", prompt: "处理B" },
    ],
    boardTasks: [
      {
        id: "t1",
        boardId: "b1",
        name: "汇聚",
        edgeIds: ["e1", "e2"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeTaskId: "t1",
    mainView: "board",
  })

  let n = 0
  await t.page.unroute("**/chat/completions").catch(() => {})
  await t.page.route("**/chat/completions", (route) => {
    n++
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: "输出" + n } }] })}\n\ndata: [DONE]\n\n`,
    })
  })

  await t.page.getByRole("button", { name: /运行任务/ }).click()

  const s = await t.stateUntil(
    (x) => (x.boardNodes.find((b) => b.id === "d")?.runs?.length ?? 0) === 2,
    8000,
    "两条线都执行完成"
  )
  t.eq(n, 2, "发起了 2 次请求")
  const d = s.boardNodes.find((b) => b.id === "d")
  t.ok(d.contentOverride.includes("输出1"), "保留了第一条线的产出")
  t.ok(d.contentOverride.includes("输出2"), "保留了第二条线的产出")
  t.ok(d.contentOverride.includes("处理B"), "拼接处带了第二条线的提示词标识")
  t.eq(d.runs.length, 2, "两条线各留一条历史")
}

/* ---------------- 颜色标记 / 单线执行 / 思考开关 / 历史（board-colors-and-run） ---------------- */

/** 节点、连线、会话都能标色并持久化 */
cases.colorMarks = async (t) => {
  const now = Date.now()
  await t.seed({
    ...seedFlow(),
    conversations: [
      { ...defaultSeed().conversations[0], hue: undefined },
    ],
  })
  await t.untilVisible(".react-flow__node[data-id='a']")

  // 节点：点色点按钮选一个预设色
  await t.page
    .locator(".react-flow__node[data-id='a']")
    .getByTitle("标记颜色")
    .click()
  await t.page.locator("[data-hue='200']").first().click()

  const s1 = await t.stateUntil(
    (x) => x.boardNodes.find((n) => n.id === "a")?.hue === 200,
    3000,
    "节点颜色已保存"
  )
  t.eq(s1.boardNodes.find((n) => n.id === "a").hue, 200, "节点 hue=200")

  // 连线：边编辑器里选色
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.locator("[data-hue='280']").first().click()
  await t.page.getByRole("button", { name: "保存" }).click()

  const s2 = await t.stateUntil(
    (x) => x.boardEdges[0]?.hue === 280,
    3000,
    "连线颜色已保存"
  )
  t.eq(s2.boardEdges[0].hue, 280, "连线 hue=280")
}

/** 会话颜色：侧边栏可标色 */
cases.colorConversation = async (t) => {
  await t.seed(seedFlow())
  await t.untilVisible("aside")

  const row = t.page.locator("aside").getByText("状态管理").first()
  await row.hover()
  await t.page
    .locator("aside")
    .getByRole("button", { name: "会话操作" })
    .first()
    .click()
  await t.page.getByRole("menuitem", { name: /标记颜色/ }).click()
  await t.page.locator("[data-hue='150']").first().click()

  const s = await t.stateUntil(
    (x) => x.conversations[0]?.hue === 150,
    3000,
    "会话颜色已保存"
  )
  t.eq(s.conversations[0].hue, 150, "conversation hue=150")
}

/** 暗色下淡背景与文字色必须有亮度差，防过曝 */
cases.hueDarkContrast = async (t) => {
  await t.page.goto(URL, { waitUntil: "domcontentloaded" })
  const out = await t.page.evaluate(async () => {
    const mod = await import("/src/lib/hue.ts")
    const parseL = (s) => {
      const m = s.match(/(\d+)%\s*\)?$/)
      return m ? Number(m[1]) : null
    }
    const light = { bg: mod.hueBg(45, false), text: mod.hueText(45, false) }
    const dark = { bg: mod.hueBg(45, true), text: mod.hueText(45, true) }
    return {
      lightBgL: parseL(light.bg),
      darkBgL: parseL(dark.bg),
      lightRaw: light,
      darkRaw: dark,
    }
  })
  t.ok(out.lightBgL !== null && out.darkBgL !== null, "色值可解析")
  t.ok(
    out.darkBgL < out.lightBgL,
    `暗色背景更暗（light=${out.lightBgL}% dark=${out.darkBgL}%）`
  )
  // 两套主题都不应使用同一个字符串
  t.ok(
    out.lightRaw.bg !== out.darkRaw.bg,
    "暗色不再复用浅色值（修复过曝）"
  )
}

/** 不建任务，直接跑一条线 */
cases.runSingleEdge = async (t) => {
  const seed = seedFlow()
  seed.boardEdges[0].prompt = "直接跑这一条"
  await t.seed(seed)

  await t.mockReply("单线输出")
  await t.untilVisible(".react-flow__edge-path")

  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.getByRole("button", { name: /立即执行/ }).click()

  const s = await t.stateUntil(
    (x) => x.boardNodes.find((n) => n.id === "b")?.runs?.length === 1,
    8000,
    "单线执行完成"
  )
  const target = s.boardNodes.find((n) => n.id === "b")
  t.eq(target.contentOverride, "单线输出", "结果写回终点")
  t.eq(target.runs[0].prompt, "直接跑这一条", "历史记录提示词")
  t.eq(s.boardTasks.length, 0, "没有创建任何任务")
}

/** 键盘执行：选中线按 Enter */
cases.runEdgeKeyboard = async (t) => {
  const seed = seedFlow()
  seed.boardEdges[0].prompt = "键盘执行"
  await t.seed(seed)

  await t.mockReply("键盘输出")
  await t.untilVisible(".react-flow__edge-path")

  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  // 关闭编辑器，保证焦点不在输入框
  await t.page.keyboard.press("Escape")
  await t.page.waitForTimeout(200)

  // 重新选中线（编辑器关掉后仍需保持选中）
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.keyboard.press("Escape")
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.keyboard.press("Escape")
  await t.page.waitForTimeout(150)

  // 用 Ctrl+Enter 触发（不依赖编辑器内的输入框）
  await t.page.locator(".react-flow__edge-path").first().click({ force: true })
  await t.page.keyboard.press("Control+Enter")

  const s = await t.stateUntil(
    (x) => (x.boardNodes.find((n) => n.id === "b")?.runs?.length ?? 0) >= 1,
    8000,
    "键盘触发了执行"
  )
  t.ok(
    (s.boardNodes.find((n) => n.id === "b").runs?.length ?? 0) >= 1,
    "键盘执行生效"
  )
}

/** 关闭思考后：请求体不含额外字段，界面不展示思维链 */
cases.thinkingToggle = async (t) => {
  const seed = seedFlow()
  seed.thinkingEnabled = false
  await t.seed(seed)
  await t.untilVisible(".react-flow__node")

  let body = null
  await t.page.unroute("**/chat/completions").catch(() => {})
  await t.page.route("**/chat/completions", (route) => {
    body = route.request().postDataJSON()
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ choices: [{ delta: { content: "答" } }] })}\n\n` +
        `data: [DONE]\n\n`,
    })
  })

  // 在对话里发一条消息
  const ta = t.page.locator("textarea").first()
  await ta.fill("测试思考开关")
  await t.page.keyboard.press("Enter")
  await t.untilState((x) => x.conversations[0].messages.some((m) => m.content === "答"), 8000)

  t.ok(body !== null, "捕获到请求体")
  t.eq(body.model, "deepseek-v4-pro", "模型不变")
  // 保守实现：关闭思考时不发送任何非标参数
  t.ok(!("thinking" in body), "未发送 thinking 字段")
  t.ok(!("reasoning_effort" in body), "未发送 reasoning_effort 字段")
  t.ok(!("enable_thinking" in body), "未发送 enable_thinking 字段")

  const s = await t.state()
  t.eq(s.thinkingEnabled, false, "设置已持久化")
}

/** 历史区渲染出时间、提示词、输入摘要 */
cases.historyRendering = async (t) => {
  const now = Date.now()
  const seed = seedFlow()
  seed.boardNodes[1].contentOverride = "历史输出内容"
  seed.boardNodes[1].runs = [
    {
      id: "r1",
      edgeId: "e1",
      prompt: "提炼核心论点",
      inputs: [{ nodeId: "a", title: "材料A", text: "这是一段输入材料" }],
      output: "历史输出内容",
      createdAt: now,
    },
  ]
  await t.seed(seed)

  await t.untilVisible(".react-flow__node[data-id='b']")
  await t.page
    .locator(".react-flow__node[data-id='b']")
    .getByTitle("历史")
    .click()

  const hist = t.page.locator("[data-history]").first()
  await hist.waitFor({ state: "visible" })
  const text = await hist.innerText()

  t.ok(/\d{1,2}:\d{2}:\d{2}/.test(text), `含时间 (${text.slice(0, 40)})`)
  t.ok(text.includes("提炼核心论点"), "含提示词")
  t.ok(text.includes("历史输出内容"), "含输出内容")
  t.ok(/输入/.test(text), "含输入摘要标识")
}

runAll(cases)
console.log("URL:", URL)
