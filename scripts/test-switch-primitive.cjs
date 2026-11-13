const { runAll } = require("./test-harness.cjs")

/**
 * 思考模式开关（switch-primitive）。
 *
 * 守住的回归点：
 *  1. 开关由 Base UI 原语渲染 —— 轨道/滑块各自成节点，不再是一团同色轮廓
 *  2. 点击开关本体可切换
 *  3. 点击「思考模式」文字也能切换（label 关联，扩大点击热区）
 *  4. 两种状态下滑块都完整落在轨道内，不越界
 *  5. 切换结果能持久化到 thinkingEnabled
 *
 * 单独跑某例：CASE=名字 node scripts/test-switch-primitive.cjs
 */

// 用 role 定位，新旧实现都具备，避免把测试钉死在新实现的内部标记上
const SWITCH = "[role='switch']"
const THUMB = "[role='switch'] > span"

/** 打开设置弹窗（侧边栏底部「设置」按钮） */
async function openSettings(t) {
  await t.page.getByRole("button", { name: "设置" }).click()
  await t.untilVisible(SWITCH)
}

/** 种默认数据后打开设置弹窗 */
async function openSettingsFresh(t) {
  await t.seed()
  await openSettings(t)
}

/** 读开关及其滑块的几何信息 */
async function geometry(t) {
  return t.page.evaluate(() => {
    const root = document.querySelector("[role='switch']")
    const thumb = root.querySelector(":scope > span")
    const r = root.getBoundingClientRect()
    const h = thumb.getBoundingClientRect()
    const cs = getComputedStyle(root)
    const hs = getComputedStyle(thumb)

    // 浏览器可能把颜色折算成 oklab/oklch，统一画到 canvas 再读 RGB
    const cv = document.createElement("canvas")
    cv.width = cv.height = 1
    const cx = cv.getContext("2d")
    const toRgb = (color) => {
      cx.clearRect(0, 0, 1, 1)
      cx.fillStyle = "#000"
      cx.fillStyle = color
      cx.fillRect(0, 0, 1, 1)
      const [r8, g8, b8] = cx.getImageData(0, 0, 1, 1).data
      return 0.299 * r8 + 0.587 * g8 + 0.114 * b8
    }

    return {
      checked: root.getAttribute("aria-checked") === "true",
      root: { left: r.left, right: r.right, width: r.width, height: r.height },
      thumb: { left: h.left, right: h.right, width: h.width, height: h.height },
      trackBg: cs.backgroundColor,
      thumbBg: hs.backgroundColor,
      // 卡片背景（弹窗底色）—— 轨道的轮廓靠与它的对比显现
      surfaceBg: (() => {
        const dlg = root.closest("[role='dialog']") || document.body
        return getComputedStyle(dlg).backgroundColor
      })(),
      lumaGap: Math.abs(toRgb(cs.backgroundColor) - toRgb(hs.backgroundColor)),
      // 轨道与卡片背景的亮度差：旧实现关闭态 bg-muted ≈247 vs 卡片 255，只差 8，
      // 轨道边界在视觉上消失，只剩滑块一圈轮廓
      trackVsSurface: Math.abs(
        toRgb(cs.backgroundColor) -
          toRgb(getComputedStyle(root.closest("[role='dialog']") || document.body).backgroundColor)
      ),
      role: root.getAttribute("role"),
    }
  })
}

const cases = {
  /** 开关存在且是真正的 switch 语义 */
  async rendersAsSwitch(t) {
    await openSettingsFresh(t)
    t.eq(await t.count(SWITCH), 1, "设置弹窗内只有一个开关")
    t.eq(await t.count(THUMB), 1, "滑块是独立节点（不再是退化成一团轮廓）")
    const g = await geometry(t)
    t.eq(g.role, "switch", "具备 role=switch")
    t.ok(g.checked, "默认开启（thinkingEnabled 未显式关闭）")
    t.ok(
      g.root.width > 0 && g.root.height > 0,
      `轨道有实际尺寸 ${g.root.width}x${g.root.height}`
    )
  },

  /** 关闭态轨道与滑块必须能区分 —— 这是原始 bug 的核心 */
  async trackAndThumbContrast(t) {
    await openSettingsFresh(t)
    // 先切到关闭态
    await t.page.locator(SWITCH).click()
    await t.settle()
    const off = await geometry(t)
    t.ok(!off.checked, "已切到关闭态")
    t.ok(
      off.lumaGap >= 20,
      `关闭态轨道与滑块需有可辨亮度差：轨道 ${off.trackBg} / 滑块 ${off.thumbBg}，亮度差 ${off.lumaGap.toFixed(1)}（需 ≥20）`
    )
    // 关键：关闭态轨道不能和卡片底色融成一片（旧实现 bg-muted 与 bg-background 只差 8）
    t.ok(
      off.trackVsSurface >= 12,
      `关闭态轨道需在白卡片上可辨：轨道 ${off.trackBg} vs 卡片 ${off.surfaceBg}，亮度差 ${off.trackVsSurface.toFixed(1)}（需 ≥12）`
    )

    // 再切回开启态
    await t.page.locator(SWITCH).click()
    await t.settle()
    const on = await geometry(t)
    t.ok(on.checked, "已切到开启态")
    t.ok(
      on.lumaGap >= 20,
      `开启态轨道与滑块需有可辨亮度差：轨道 ${on.trackBg} / 滑块 ${on.thumbBg}，亮度差 ${on.lumaGap.toFixed(1)}（需 ≥20）`
    )
    t.ok(
      off.trackBg !== on.trackBg,
      "开启/关闭两态轨道配色必须不同"
    )  },

  /** 滑块在两种状态下都不越出轨道（原实现 translate-x-4.5 会顶出右缘） */
  async thumbStaysInsideTrack(t) {
    await openSettingsFresh(t)

    const on = await geometry(t)
    t.ok(
      on.thumb.left >= on.root.left - 0.5 &&
        on.thumb.right <= on.root.right + 0.5,
      `开启态滑块在轨道内：滑块 [${on.thumb.left.toFixed(1)}, ${on.thumb.right.toFixed(
        1
      )}] ⊂ 轨道 [${on.root.left.toFixed(1)}, ${on.root.right.toFixed(1)}]`
    )

    await t.page.locator(SWITCH).click()
    await t.settle()
    const off = await geometry(t)
    t.ok(
      off.thumb.left >= off.root.left - 0.5 &&
        off.thumb.right <= off.root.right + 0.5,
      `关闭态滑块在轨道内：滑块 [${off.thumb.left.toFixed(1)}, ${off.thumb.right.toFixed(
        1
      )}] ⊂ 轨道 [${off.root.left.toFixed(1)}, ${off.root.right.toFixed(1)}]`
    )
  },

  /** 点击开关本体切换，并在保存后持久化到 thinkingEnabled */
  async toggleBySwitchClick(t) {
    await openSettingsFresh(t)

    await t.page.locator(SWITCH).click()
    await t.settle()
    t.ok(!(await geometry(t)).checked, "点击开关后变为关闭")

    // 设置项在点「保存」后才落盘
    await t.page.getByRole("button", { name: "保存" }).click()
    await t.untilState((s) => s.thinkingEnabled === false, 3000)
    const s = await t.state()
    t.eq(s.thinkingEnabled, false, "保存后 thinkingEnabled 持久化为 false")

    // 重新打开，状态应回显为关闭
    await openSettings(t)
    t.ok(!(await geometry(t)).checked, "重新打开后回显为关闭")

    await t.page.locator(SWITCH).click()
    await t.settle()
    t.ok((await geometry(t)).checked, "再次点击回到开启")
    await t.page.getByRole("button", { name: "保存" }).click()
    await t.untilState((x) => x.thinkingEnabled === true, 3000)
  },

  /** 点击「思考模式」文字也能切换（label 关联，热区更大） */
  async toggleByLabelClick(t) {
    await openSettingsFresh(t)
    t.ok((await geometry(t)).checked, "初始为开启")

    await t.page.getByText("思考模式", { exact: true }).click()
    await t.settle()
    t.ok(!(await geometry(t)).checked, "点击文字后变为关闭")

    await t.page.getByText("思考模式", { exact: true }).click()
    await t.settle()
    t.ok((await geometry(t)).checked, "再次点击文字回到开启")
  },
}

module.exports = { cases }

if (require.main === module) {
  runAll(cases, { only: process.env.CASE })
}
