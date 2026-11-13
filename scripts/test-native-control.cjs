/**
 * 回归测试：平板浏览器不得用系统外观绘制 Base UI 的「幽灵 input」。
 *
 * 背景（见 doc/feat/touch-native-control-clip.md）：
 * Base UI 的 Checkbox 在自绘 <span data-slot="checkbox"> 旁边额外渲染一个
 * 仅供表单提交的 <input type="checkbox">，它只有内联 visuallyHidden 样式，
 * 缺少 appearance:none。桌面不绘制它，平板会按系统控件再画一遍，
 * 于是原生勾选图标/点按高亮压到自绘方框上。
 *
 * 断言重点在**幽灵 input 的 computed style**，而不是像素截图：
 * 换成真机只需同一份断言（设备描述符见下面 TARGETS）。
 *
 * 运行：
 *   npm run build && npx vite preview --port 5199 &
 *   APP_URL=http://127.0.0.1:5199/ node scripts/test-native-control.cjs
 */
const { runAll, defaultSeed } = require("./test-harness.cjs")

/** 有两条收藏的种子数据，保证收藏面板里能渲染出 Checkbox */
function favSeed() {
  const base = defaultSeed()
  const now = Date.now()
  return {
    ...base,
    favorites: [
      { id: "f1", conversationId: "c1", messageId: "m1", tagIds: [], createdAt: now },
      { id: "f2", conversationId: "c1", messageId: "m2", tagIds: [], createdAt: now + 1 },
    ],
  }
}

/** 读取第一个勾选框及其幽灵 input 的关键几何/样式 */
function probe(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-slot="checkbox"]')
    if (!root) return { found: false }
    const input = root.nextElementSibling
    const cs = getComputedStyle(input)
    const ir = input.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const indEl = root.querySelector('[data-slot="checkbox-indicator"]')
    const ind = indEl ? indEl.getBoundingClientRect() : null
    return {
      found: true,
      siblingIsCheckboxInput:
        input.tagName === "INPUT" && input.getAttribute("type") === "checkbox",
      input: {
        appearance: cs.appearance,
        webkitAppearance: cs.webkitAppearance,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        width: Math.round(ir.width * 100) / 100,
        height: Math.round(ir.height * 100) / 100,
      },
      // 幽灵 input 的位置是否落在自绘方框之内（落进去才可能被系统画在方框上）
      inputInsideRootBox:
        ir.x >= rr.x - 0.5 &&
        ir.y >= rr.y - 0.5 &&
        ir.right <= rr.right + 0.5 &&
        ir.bottom <= rr.bottom + 0.5,
      root: {
        w: Math.round(rr.width),
        h: Math.round(rr.height),
        bg: getComputedStyle(root).backgroundColor,
        ariaChecked: root.getAttribute("aria-checked"),
      },
      indicator: ind && {
        w: Math.round(ind.width),
        h: Math.round(ind.height),
        // 勾是否居中于方框：两者中心点差值（px）
        dx: Math.round((ind.x + ind.width / 2 - (rr.x + rr.width / 2)) * 100) / 100,
        dy: Math.round((ind.y + ind.height / 2 - (rr.y + rr.height / 2)) * 100) / 100,
      },
    }
  })
}

/** 打开收藏面板（侧栏那个「收藏」入口） */
async function openFavorites(t) {
  await t.page.locator("aside").first().getByRole("button", { name: /^收藏/ }).first().click()
  await t.page.locator('[data-aux-panel="favorites"]').waitFor({ state: "visible" })
  await t.page.locator('[data-slot="checkbox"]').first().waitFor({ state: "visible" })
}

/** 系统绘制被压制的判定：四条同时成立 */
function assertSuppressed(t, p, label) {
  t.ok(p.found, `${label}: 渲染出勾选框`)
  t.ok(p.siblingIsCheckboxInput, `${label}: 幽灵 input 是根节点的相邻兄弟`)
  t.eq(p.input.appearance, "none", `${label}: 幽灵 input appearance`)
  t.eq(p.input.opacity, "0", `${label}: 幽灵 input opacity`)
  t.eq(p.input.pointerEvents, "none", `${label}: 幽灵 input 不参与命中`)
  t.eq([p.input.width, p.input.height], [1, 1], `${label}: 幽灵 input 收成 1x1`)
  t.ok(!p.inputInsideRootBox, `${label}: 幽灵 input 不落在自绘方框内`)
}

const cases = {
  async ghostInputSuppressed(t) {
    await t.seed(favSeed())
    await openFavorites(t)
    assertSuppressed(t, await probe(t.page), "未勾选")
  },

  async ghostInputStaysSuppressedAfterToggle(t) {
    await t.seed(favSeed())
    await openFavorites(t)
    const box = t.page.locator('[data-slot="checkbox"]').first()

    await box.click()
    await t.settle()
    const checked = await probe(t.page)
    assertSuppressed(t, checked, "勾选后")
    t.eq(checked.root.ariaChecked, "true", "勾选后 aria-checked")
    t.ok(checked.root.bg !== "rgba(0, 0, 0, 0)", "勾选后方框有自绘背景")
    // 勾必须精确居中于方框（Indicator 改 absolute inset-0 的回归点）
    t.eq([checked.indicator.dx, checked.indicator.dy], [0, 0], "勾相对方框居中")

    await box.click()
    await t.settle()
    const unchecked = await probe(t.page)
    assertSuppressed(t, unchecked, "取消勾选后")
    t.eq(unchecked.root.ariaChecked, "false", "取消勾选后 aria-checked")
    // 背景色断言交给「勾选后 ≠ 未勾选后」的对比，不写死颜色值：
    // 悬停/过渡态会叠加 alpha，写死 rgba(0,0,0,0) 会偶发假失败
    t.ok(
      checked.root.bg !== unchecked.root.bg,
      `取消勾选后回到未选中背景 (勾选 ${checked.root.bg} / 取消 ${unchecked.root.bg})`
    )
  },
}

// CASE=名字 只跑单个
runAll(cases, { only: process.env.CASE })
