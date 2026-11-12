/**
 * board-v2 浏览器验证：渲染、拖拽、缩放方向。
 *
 *   npm run dev
 *   node scripts/test-board-v2-ui.cjs
 */
const { chromium } = require("playwright")

const URL = "http://127.0.0.1:5199/"

function seed() {
  const now = Date.now()
  return {
    projects: [],
    conversations: [
      {
        id: "c1",
        projectId: null,
        title: "测试对话",
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: "m1", role: "user", content: "第一条消息", createdAt: now },
          { id: "m2", role: "assistant", content: "第二条消息内容", createdAt: now + 1 },
        ],
      },
    ],
    favorites: [],
    tags: [],
    boards: [{ id: "b1", projectId: null, name: "板A", createdAt: now, updatedAt: now }],
    boardNodes: [
      {
        id: "n1",
        boardId: "b1",
        kind: "message",
        ref: { conversationId: "c1", messageId: "m2" },
        x: 100,
        y: 100,
        createdAt: now,
      },
      {
        id: "n2",
        boardId: "b1",
        kind: "note",
        title: "便签",
        note: "手写内容",
        x: 500,
        y: 100,
        createdAt: now,
      },
    ],
    boardEdges: [],
    boardTasks: [],
    activeBoardId: "b1",
    activeConversationId: "c1",
    activeProjectId: null,
    mainView: "board",
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    thinkingEnabled: false,
    sidebarView: "list",
  }
}

const results = []
function check(name, ok, extra = "") {
  results.push({ name, ok, extra })
  console.log(`${ok ? "✔" : "✖"} ${name}${extra ? ` — ${extra}` : ""}`)
}

;(async () => {
  const browser = await chromium.launch({ channel: "chromium" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })

  await page.goto(URL, { waitUntil: "domcontentloaded" })
  await page.evaluate((s) => {
    localStorage.clear()
    localStorage.setItem("shadcn-chat/state/v1", JSON.stringify(s))
  }, seed())
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)

  /* ---------- 1. 渲染 ---------- */
  const nodeCount = await page.locator(".react-flow__node").count()
  check("画布渲染 2 个节点", nodeCount === 2, `实际 ${nodeCount}`)

  const handles = await page.locator(".board2-handle").count()
  check("每节点 8 个手柄", handles === 16, `实际 ${handles}`)

  const noteVisible = await page.getByText("手写内容").first().isVisible().catch(() => false)
  check("便签正文渲染", noteVisible)

  /* ---------- 2. 向左缩放 ---------- */
  const node = page.locator(".react-flow__node[data-id='n1']")
  await node.click()
  await page.waitForTimeout(300)

  const box = async () => {
    const b = await node.boundingBox()
    return { left: b.x, right: b.x + b.width, width: b.width }
  }

  const before = await box()
  // v2 自己实现的缩放手柄（不再用 NodeResizer 的 .react-flow__resize-control）
  const resizer = page.locator(
    ".react-flow__node[data-id='n1'] .board2-resize-handle[data-resize-dir='w']"
  )
  const hasResizer = (await resizer.count()) > 0
  check("选中后出现缩放手柄", hasResizer)

  if (hasResizer) {
    const hb = await resizer.first().boundingBox()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x - 120, hb.y + hb.height / 2, { steps: 10 })
    const mid = await box()
    await page.mouse.up()

    check("向左拉伸：宽度增大", mid.width > before.width + 60, `${before.width} → ${mid.width}`)
    check("向左拉伸：左边缘左移", mid.left < before.left - 60, `${before.left} → ${mid.left}`)
    check("向左拉伸：右边缘不动", Math.abs(mid.right - before.right) < 8, `右 ${before.right} → ${mid.right}`)

    // 落库检查
    await page.waitForTimeout(600)
    const st = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
    )
    const n1 = st.boardNodes.find((n) => n.id === "n1")
    check("缩放尺寸已落库", n1.width > 260, `width=${n1.width}`)
    check("缩放位置已落库", n1.x < 100, `x=${n1.x}`)
  }

  /* ---------- 3. 拖拽 ---------- */
  const beforeDrag = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shadcn-chat/state/v1")).boardNodes.find((n) => n.id === "n1")
  )
  const dragBox = await node.boundingBox()
  await page.mouse.move(dragBox.x + 40, dragBox.y + 8)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + 140, dragBox.y + 108, { steps: 10 })
  const during = await node.boundingBox()
  check("拖拽中途已跟手", during.x > dragBox.x + 50, `${dragBox.x} → ${during.x}`)
  await page.mouse.up()

  await page.waitForTimeout(600)
  const st2 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
  )
  const n1b = st2.boardNodes.find((n) => n.id === "n1")
  check(
    "拖拽位移已落库",
    n1b.x > beforeDrag.x && n1b.y > beforeDrag.y,
    `(${beforeDrag.x},${beforeDrag.y}) → (${n1b.x},${n1b.y})`
  )

  /* ---------- 4. 连线 ---------- */
  // 手柄的 side 由 React Flow 的 placement 类给出：right/left/top/bottom
  const srcHandle = page.locator(
    ".react-flow__node[data-id='n1'] .board2-handle-source.react-flow__handle-right"
  )
  const tgtHandle = page.locator(
    ".react-flow__node[data-id='n2'] .board2-handle-target.react-flow__handle-left"
  )
  const sb = await srcHandle.first().boundingBox()
  const tb = await tgtHandle.first().boundingBox()
  if (sb && tb) {
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const st3 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("shadcn-chat/state/v1"))
    )
    check("连线已建立", st3.boardEdges.length === 1, `edges=${st3.boardEdges.length}`)
  } else {
    check("连线已建立", false, "手柄定位失败")
  }

  /* ---------- 5. 无运行时错误 ---------- */
  const realErrors = errors.filter(
    (e) => !e.includes("favicon") && !e.includes("Download the React DevTools")
  )
  check("无控制台错误", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))

  await page.screenshot({ path: "/tmp/board-v2.png", fullPage: false })
  await browser.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length === 0 ? 0 : 1)
})()
