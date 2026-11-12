/**
 * 新卡片落点（layout.ts）不变量测试：node --test scripts/test-board-layout.ts
 *
 * 每条用例对应 doc/feat/board-branch-layout.md「规范一」里的一条不变量。
 * 这是「分支卡片堆叠」的直接回归点：旧实现用 index 取模网格，
 * 删卡后 index 回流、分支消息与父卡片毫无几何关系，必然重叠。
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  BRANCH_OFFSET_X,
  LAYOUT_GAP,
  findBranchParent,
  overlaps,
  placeBatch,
  placeCard,
  type Rect,
} from "../src/features/board-v2/model/layout.ts"

/* ---------------- 测试工具 ---------------- */

const SIZE = { width: 260, height: 140 }

/** 断言落点与任何已有卡片都不相交 */
function assertNoOverlap(point: { x: number; y: number }, cards: Rect[], msg: string) {
  const box: Rect = { x: point.x, y: point.y, ...SIZE }
  for (const c of cards) {
    assert.equal(
      overlaps(box, c),
      false,
      `${msg}：落点 ${JSON.stringify(point)} 与卡片 ${JSON.stringify(c)} 重叠`
    )
  }
}

/** 常用布局：一行三张（模拟用户手工拖过的整齐排布） */
function rowOfThree(): Rect[] {
  return [
    { x: 0, y: 0, ...SIZE },
    { x: 320, y: 0, ...SIZE },
    { x: 640, y: 0, ...SIZE },
  ]
}

/* ---------------- 不变量 1：不重叠 ---------------- */

test("空画布：落点即原点", () => {
  assert.deepEqual(placeCard({ cards: [], edges: [], size: SIZE }), { x: 0, y: 0 })
})

test("有卡片时落在空位，不与任何已有卡片重叠", () => {
  const cards = rowOfThree()
  const p = placeCard({ cards, edges: [], size: SIZE })
  assertNoOverlap(p, cards, "无 anchor")
})

test("删卡后 index 回流的老 bug：新卡不得压到现存卡片上", () => {
  // 旧实现：index=4 → col=1,row=1 → (320,220)，与 n5 重合
  const cards: Rect[] = [
    { x: 0, y: 0, ...SIZE },
    { x: 640, y: 0, ...SIZE }, // n2 被删
    { x: 0, y: 220, ...SIZE }, // n4 被删（这里保留示意）
  ]
  const p = placeCard({ cards, edges: [], size: SIZE })
  assertNoOverlap(p, cards, "删卡后")
  assert.notDeepEqual(p, { x: 320, y: 220 }, "不得落回旧网格格子")
})

/* ---------------- 不变量 2：分支向右 ---------------- */

test("分支：落点在 anchor 右侧，垂直不超过 anchor 下边缘太多", () => {
  const anchor: Rect = { x: 0, y: 0, ...SIZE }
  const p = placeCard({
    cards: [anchor],
    edges: [],
    size: SIZE,
    anchor: "n1",
    occupied: [{ id: "n1", ...anchor }],
    relation: "branch",
  })
  assert.ok(p.x >= anchor.x + anchor.width, `分支应在右侧，实际 x=${p.x}`)
  assert.ok(p.x - anchor.x <= BRANCH_OFFSET_X * 2, "分支不应被推得过远")
  assert.ok(p.y >= anchor.y - SIZE.height, "分支不应跑到 anchor 上方")
})

test("同一 anchor 的第二个分支落在第一个分支正下方（兄弟下排）", () => {
  const anchor: Rect = { x: 0, y: 0, ...SIZE }
  const first = { x: BRANCH_OFFSET_X, y: 0, ...SIZE }
  const p = placeCard({
    cards: [anchor, first],
    edges: [{ from: "n1", to: "n2" }],
    size: SIZE,
    anchor: "n1",
    occupied: [
      { id: "n1", ...anchor },
      { id: "n2", ...first },
    ],
    relation: "branch",
  })
  assert.equal(p.x, first.x, "兄弟分支应同列")
  assert.ok(p.y >= first.y + first.height, `兄弟分支应在下方，实际 y=${p.y}`)
  assertNoOverlap(p, [anchor, first], "兄弟分支")
})

test("分支落点避开右侧已有的无关卡片", () => {
  const anchor: Rect = { x: 0, y: 0, ...SIZE }
  const blocking: Rect = { x: BRANCH_OFFSET_X, y: 0, ...SIZE }
  const p = placeCard({
    cards: [anchor, blocking],
    edges: [],
    size: SIZE,
    anchor: "n1",
    occupied: [
      { id: "n1", ...anchor },
      { id: "nX", ...blocking },
    ],
    relation: "branch",
  })
  assertNoOverlap(p, [anchor, blocking], "避让无关卡片")
})

test("anchor 指向不存在的卡片：当作无 anchor 处理，仍不重叠", () => {
  const cards = rowOfThree()
  const p = placeCard({
    cards,
    edges: [],
    size: SIZE,
    anchor: "ghost",
    occupied: cards.map((c, i) => ({ id: `n${i}`, ...c })),
    relation: "branch",
  })
  assertNoOverlap(p, cards, "anchor 失效")
})

/* ---------------- 不变量 3：承接向下 ---------------- */

test("承接（chain）：落在 anchor 下方同一列", () => {
  const anchor: Rect = { x: 320, y: 0, ...SIZE }
  const p = placeCard({
    cards: [anchor],
    edges: [],
    size: SIZE,
    anchor: "n1",
    occupied: [{ id: "n1", ...anchor }],
    relation: "chain",
  })
  assert.equal(p.x, anchor.x, "承接应保持同列")
  assert.ok(p.y >= anchor.y + anchor.height, `承接应在下方，实际 y=${p.y}`)
})

/* ---------------- 不变量 5：无 anchor 时按图层落位 ---------------- */

test("无 anchor 且已有连线：落在链路末端右下方", () => {
  const a: Rect = { x: 0, y: 0, ...SIZE }
  const b: Rect = { x: 0, y: 200, ...SIZE }
  const p = placeCard({
    cards: [a, b],
    edges: [{ from: "n1", to: "n2" }],
    size: SIZE,
    occupied: [
      { id: "n1", ...a },
      { id: "n2", ...b },
    ],
  })
  assertNoOverlap(p, [a, b], "链路末端")
  assert.ok(p.y > b.y || p.x > b.x, "应落在链路末端之外")
})

/* ---------------- 不变量 6：恒有限 / 拥挤不重叠 ---------------- */

test("极端拥挤：扫描上限用尽后仍不重叠", () => {
  // 造一个 7×7 的密铺，把「附近」全部占满
  const cards: Rect[] = []
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      cards.push({
        x: col * (SIZE.width + LAYOUT_GAP),
        y: row * (SIZE.height + LAYOUT_GAP),
        ...SIZE,
      })
    }
  }
  const p = placeCard({
    cards,
    edges: [],
    size: SIZE,
    occupied: cards.map((c, i) => ({ id: `n${i}`, ...c })),
  })
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "坐标必须有限")
  assertNoOverlap(p, cards, "拥挤兜底")
})

test("非法输入：NaN / 负尺寸 / 空 size 都返回有限坐标", () => {
  const cards: Rect[] = [{ x: NaN, y: -Infinity, width: 0, height: 0 }]
  const p = placeCard({ cards, edges: [], size: { width: NaN, height: -5 } })
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "坐标必须有限")
})

/* ---------------- 批量落点 ---------------- */

test("placeBatch：同批次卡片两两不重叠，且不成同一个点", () => {
  const existing: Rect[] = [{ x: 0, y: 0, ...SIZE }]
  const points = placeBatch({
    cards: existing,
    edges: [],
    sizes: [SIZE, SIZE, SIZE],
    ids: ["a", "b", "c"],
  })
  assert.equal(points.length, 3)
  for (let i = 0; i < points.length; i++) {
    assertNoOverlap(points[i], existing, `批量第 ${i} 张 与已存在`)
    for (let j = i + 1; j < points.length; j++) {
      assert.notDeepEqual(points[i], points[j], `批量第 ${i} 与第 ${j} 张重叠`)
      const a: Rect = { ...points[i], ...SIZE }
      const b: Rect = { ...points[j], ...SIZE }
      assert.equal(overlaps(a, b), false, `批量第 ${i} 与第 ${j} 张相交`)
    }
  }
})

test("placeBatch：指定 chain 时逐张向下成链", () => {
  const points = placeBatch({
    cards: [],
    edges: [],
    sizes: [SIZE, SIZE],
    ids: ["a", "b"],
    mode: "chain",
  })
  assert.equal(points[0].x, 0)
  assert.equal(points[1].x, 0, "链条同列")
  assert.ok(points[1].y >= SIZE.height, "第二张在第一张下方")
})

/* ---------------- 分支父卡片识别 ---------------- */

function conv(id: string, messageIds: string[], branchedFrom?: { conversationId: string; messageId: string }) {
  return {
    id,
    projectId: "p1",
    title: id,
    createdAt: 0,
    updatedAt: 0,
    messages: messageIds.map((m) => ({ id: m, role: "user" as const, content: m, createdAt: 0 })),
    ...(branchedFrom ? { branchedFrom: { conversationTitle: id, ...branchedFrom } } : {}),
  }
}

test("findBranchParent：分支对话的消息映射回源对话同下标消息的卡片", () => {
  // c1: m1, m2, m3；从 m2 分支出 c2，复制历史后 m2 在 c2 里变成 x5
  const conversations = [
    conv("c1", ["m1", "m2", "m3"]),
    conv("c2", ["x4", "x5", "x6"], { conversationId: "c1", messageId: "m2" }),
  ]
  const cards = [
    { id: "n1", ref: { conversationId: "c1", messageId: "m2" } },
    { id: "n2", ref: { conversationId: "c2", messageId: "x6" } },
  ]

  // x6 在 c2 的下标是 2；c1 下标 2 是 m3 —— 只有源卡片在画板上时才命中
  assert.equal(findBranchParent("c2", "x5", conversations, cards), "n1", "下标 1 → c1.m2 → n1")
  assert.equal(findBranchParent("c2", "x6", conversations, cards), null, "源对话下标 2 的卡片不在画板上")
  assert.equal(findBranchParent("c1", "m2", conversations, cards), null, "非分支对话没有父卡片")
})

test("findBranchParent：父对话已不存在 / 下标越界时返回 null", () => {
  const conversations = [conv("c2", ["x4"], { conversationId: "gone", messageId: "m2" })]
  const cards = [{ id: "n1", ref: { conversationId: "c2", messageId: "x4" } }]
  assert.equal(findBranchParent("c2", "x4", conversations, cards), null)
  assert.equal(findBranchParent("c2", "missing", conversations, cards), null)
  assert.equal(findBranchParent("c2", "x4", [], cards), null)
})
