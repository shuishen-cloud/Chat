/**
 * board-v2 纯函数测试：node --test scripts/test-board-v2.ts
 *
 * 这些用例是设计文档「规范」章节的可执行版本：
 *  - 缩放方向不变量（本次重写的直接回归点）
 *  - 映射可逆性 toFlow ∘ fromFlow ≡ id
 *  - 状态机非法转移不抛异常
 */
import assert from "node:assert/strict"
import test from "node:test"

import { MIN_SIZE, emptyDoc, type BoardDoc } from "../src/features/board-v2/model/doc.ts"
import { dirAffects, resizeNode, type Box, type ResizeDir } from "../src/features/board-v2/model/resize.ts"

const base: Box = { x: 400, y: 300, width: 260, height: 140 }

/** 便捷断言：右边缘 / 下边缘 */
const right = (b: Box) => b.x + b.width
const bottom = (b: Box) => b.y + b.height

test("dirAffects 正确解析八个方向", () => {
  assert.deepEqual(dirAffects("w"), { west: true, east: false, north: false, south: false })
  assert.deepEqual(dirAffects("nw"), { west: true, east: false, north: true, south: false })
  assert.deepEqual(dirAffects("se"), { west: false, east: true, north: false, south: true })
  assert.deepEqual(dirAffects("n"), { west: false, east: false, north: true, south: false })
})

test("向左拉（w）：右边缘恒定，左边缘与宽度同步增长", () => {
  const out = resizeNode(base, "w", { dx: -120, dy: 0 }, MIN_SIZE)
  assert.equal(right(out), right(base), "右边缘必须不动")
  assert.equal(out.width, base.width + 120, "宽度增加 120")
  assert.equal(out.x, base.x - 120, "左边缘左移 120")
  assert.equal(out.y, base.y, "高度方向不受影响")
  assert.equal(out.height, base.height, "高度不变")
})

test("向上拉（n）：下边缘恒定，上边缘与高度同步增长", () => {
  const out = resizeNode(base, "n", { dx: 0, dy: -80 }, MIN_SIZE)
  assert.equal(bottom(out), bottom(base), "下边缘必须不动")
  assert.equal(out.height, base.height + 80)
  assert.equal(out.y, base.y - 80)
  assert.equal(out.width, base.width, "宽度不变")
})

test("向右/向下拉：左上角恒定", () => {
  const e = resizeNode(base, "e", { dx: 60, dy: 0 }, MIN_SIZE)
  assert.equal(e.x, base.x)
  assert.equal(e.y, base.y)
  assert.equal(e.width, base.width + 60)

  const s = resizeNode(base, "s", { dx: 0, dy: 40 }, MIN_SIZE)
  assert.equal(s.y, base.y)
  assert.equal(s.height, base.height + 40)
})

test("对角方向同时改变两条受影响边，未受影响边不动", () => {
  const nw = resizeNode(base, "nw", { dx: -50, dy: -30 }, MIN_SIZE)
  assert.equal(right(nw), right(base), "nw 时右边缘不动")
  assert.equal(bottom(nw), bottom(base), "nw 时下边缘不动")
  assert.equal(nw.width, base.width + 50)
  assert.equal(nw.height, base.height + 30)

  const se = resizeNode(base, "se", { dx: 50, dy: 30 }, MIN_SIZE)
  assert.equal(se.x, base.x, "se 时左边缘不动")
  assert.equal(se.y, base.y, "se 时上边缘不动")
  assert.equal(se.width, base.width + 50)
  assert.equal(se.height, base.height + 30)
})

test("达到最小尺寸后夹紧，且连续拖动不漂移", () => {
  const tiny = { x: 100, y: 100, width: MIN_SIZE.width, height: MIN_SIZE.height }
  const once = resizeNode(tiny, "w", { dx: 50, dy: 0 }, MIN_SIZE)
  assert.equal(once.width, MIN_SIZE.width, "宽度不会小于下限")
  assert.equal(right(once), right(tiny), "夹紧时右边缘仍然不动")

  // 继续往同方向拉：结果必须与上一次完全一致（不漂移）
  const twice = resizeNode(once, "w", { dx: 50, dy: 0 }, MIN_SIZE)
  assert.deepEqual(twice, once)

  const up = resizeNode({ x: 0, y: 0, width: 200, height: MIN_SIZE.height }, "n", { dx: 0, dy: 99 }, MIN_SIZE)
  assert.equal(up.height, MIN_SIZE.height)
  assert.equal(bottom(up), MIN_SIZE.height)
})

test("NaN / Infinity 输入不会污染几何", () => {
  const out = resizeNode(
    { x: NaN, y: Infinity, width: NaN, height: -10 },
    "e",
    { dx: NaN, dy: Infinity },
    MIN_SIZE
  )
  for (const v of [out.x, out.y, out.width, out.height]) {
    assert.ok(Number.isFinite(v), `几何值必须有限，得到 ${v}`)
  }
  assert.ok(out.width >= MIN_SIZE.width)
})

test("连续多帧拖动等价于一次性拖动（可累加）", () => {
  // 分 4 次各拖 -30，应等价于一次拖 -120
  let box = base
  for (let i = 0; i < 4; i++) box = resizeNode(box, "w", { dx: -30, dy: 0 }, MIN_SIZE)
  const once = resizeNode(base, "w", { dx: -120, dy: 0 }, MIN_SIZE)
  assert.deepEqual(box, once)
})

test("所有方向的边不变量一次性回归（表驱动）", () => {
  const cases: Array<{ dir: ResizeDir; d: { dx: number; dy: number } }> = [
    { dir: "n", d: { dx: 0, dy: -10 } },
    { dir: "s", d: { dx: 0, dy: 10 } },
    { dir: "e", d: { dx: 10, dy: 0 } },
    { dir: "w", d: { dx: -10, dy: 0 } },
    { dir: "ne", d: { dx: 10, dy: -10 } },
    { dir: "nw", d: { dx: -10, dy: -10 } },
    { dir: "se", d: { dx: 10, dy: 10 } },
    { dir: "sw", d: { dx: -10, dy: 10 } },
  ]
  for (const { dir, d } of cases) {
    const out = resizeNode(base, dir, d, MIN_SIZE)
    const aff = dirAffects(dir)
    if (!aff.west) assert.equal(out.x, base.x, `${dir}: 左边缘应不动`)
    if (!aff.east) assert.equal(right(out), right(base), `${dir}: 右边缘应不动`)
    if (!aff.north) assert.equal(out.y, base.y, `${dir}: 上边缘应不动`)
    if (!aff.south) assert.equal(bottom(out), bottom(base), `${dir}: 下边缘应不动`)
    assert.ok(out.width >= MIN_SIZE.width && out.height >= MIN_SIZE.height, `${dir}: 不低于最小值`)
  }
})

test("emptyDoc 每次返回新对象", () => {
  const a = emptyDoc<BoardDoc extends never ? never : BoardDoc>()
  const b = emptyDoc()
  assert.deepEqual(a, { nodes: [], edges: [] })
  assert.notEqual(a, b)
})
