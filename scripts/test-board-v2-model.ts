/**
 * board-v2 映射与交互状态机测试。
 *
 * 覆盖设计文档里两条硬约束：
 *  - toFlow / fromFlow 可逆，且不会把框架量测尺寸误当成用户设置；
 *  - 状态机非法转移保持原状态、不抛异常（并可给出拒绝原因记日志）。
 */
import assert from "node:assert/strict"
import test from "node:test"

import { resizeNode } from "../src/features/board-v2/model/resize.ts"
import {
  MIN_SIZE,
  emptyDoc,
  type BoardDoc,
  type CardNode,
} from "../src/features/board-v2/model/doc.ts"
import {
  toFlow,
  toFlowEdges,
  fromFlow,
  fromFlowNode,
  type RtEdge,
  type RtNode,
} from "../src/features/board-v2/model/map.ts"
import {
  canStart,
  dragTargets,
  isActive,
  reduceInteraction,
  type Interaction,
} from "../src/features/board-v2/interaction/machine.ts"

function sampleDoc(): BoardDoc {
  return {
    nodes: [
      {
        id: "n1",
        position: { x: 0, y: 0 },
        card: { kind: "message", id: "n1", ref: { conversationId: "c1", messageId: "m1" }, hue: 210 },
      },
      {
        id: "n2",
        position: { x: 400, y: 120 },
        width: 300,
        height: 180,
        card: { kind: "note", id: "n2", note: "# 便签" },
      },
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "n1", handle: "s-bottom" },
        to: { nodeId: "n2", handle: "t-top" },
        kind: "flow",
        prompt: "总结要点",
        enabled: true,
        hue: 30,
      },
    ],
  }
}

test("toFlow → fromFlow 字段级往返等价", () => {
  const doc = sampleDoc()
  const nodes = toFlow(doc)
  const edges = toFlowEdges(doc)
  const back = fromFlow(nodes, edges, doc)

  assert.equal(back.nodes.length, 2)
  assert.deepEqual(back.nodes[0].position, doc.nodes[0].position)
  assert.deepEqual(back.nodes[0].card, doc.nodes[0].card)
  assert.equal(back.nodes[0].width, undefined, "自适应节点不应凭空获得尺寸")

  assert.equal(back.nodes[1].width, 300)
  assert.equal(back.nodes[1].height, 180)
  assert.deepEqual(back.nodes[1].card, doc.nodes[1].card)

  assert.equal(back.edges.length, 1)
  assert.deepEqual(back.edges[0], doc.edges[0], "边的业务字段必须完整保留")
})

test("自适应节点：框架量测出的尺寸不会被写回文档", () => {
  const doc = sampleDoc()
  const node = toFlow(doc)[0]
  assert.equal(node.data.explicitSize, false)

  // 模拟 React Flow 量测后写入 width/height
  const measured: RtNode = { ...node, width: 260, height: 88 }
  const back = fromFlowNode(measured)
  assert.equal(back.width, undefined, "量测值不是用户设置，不能落盘")
  assert.equal(back.height, undefined)
})

test("显式尺寸节点：量测值变化不影响用户设置", () => {
  const doc = sampleDoc()
  const node = toFlow(doc)[1]
  assert.equal(node.data.explicitSize, true)
  assert.equal(node.width, 300)

  const resized: RtNode = { ...node, width: 420, height: 260 }
  const back = fromFlowNode(resized)
  assert.equal(back.width, 420)
  assert.equal(back.height, 260)
})

test("fromFlow 忽略未知字段与缺失 data 的边", () => {
  const node = toFlow(sampleDoc())[0]
  const noisy: RtNode = { ...node, draggable: true, selected: true, zIndex: 9 } as RtNode
  const back = fromFlowNode(noisy)
  assert.equal(back.id, "n1")
  assert.equal((back as unknown as { selected?: boolean }).selected, undefined)

  const edge: RtEdge = { id: "e9", source: "n1", target: "n2" } as RtEdge
  const out = fromFlow([node], [edge], emptyDoc())
  assert.equal(out.edges[0].kind, "manual", "缺失 data.kind 时回落到 manual")
  assert.equal(out.edges[0].from.handle, "")
})

test("多选拖拽：整体移动 vs 只拖自己", () => {
  assert.deepEqual(dragTargets("n1", ["n1", "n2"]), ["n1", "n2"])
  assert.deepEqual(dragTargets("n1", ["n1"]), ["n1"])
  assert.deepEqual(dragTargets("n1", []), ["n1"])
  assert.deepEqual(dragTargets("n1", ["n2", "n3"]), ["n1"], "未选中它时只拖自己")
})

test("状态机：idle 下各类交互都能启动", () => {
  const idle: Interaction = { type: "idle" }
  assert.equal(reduceInteraction(idle, { type: "node:pointerdown", nodeId: "n1", selectedIds: [] }).state.type, "dragging")
  assert.equal(
    reduceInteraction(idle, { type: "resizer:pointerdown", nodeId: "n1", dir: "w" }).state.type,
    "resizing"
  )
  assert.equal(
    reduceInteraction(idle, { type: "handle:pointerdown", nodeId: "n1", handle: "s-right" }).state.type,
    "connecting"
  )
  assert.equal(reduceInteraction(idle, { type: "canvas:pointerdown" }).state.type, "marquee")
  assert.equal(reduceInteraction(idle, { type: "edge:click", edgeId: "e1" }).state.type, "edge-menu")
})

test("状态机：进行中拒绝其他交互插入（v1 的抢交互问题）", () => {
  const resizing: Interaction = { type: "resizing", nodeId: "n1", dir: "w" }

  // 缩放手柄按住时，节点拖动不能启动
  const r1 = reduceInteraction(resizing, { type: "node:pointerdown", nodeId: "n1", selectedIds: [] })
  assert.equal(r1.state.type, "resizing", "保持原状态")
  assert.ok(r1.rejected, "给出拒绝原因用于记 warning")

  const r2 = reduceInteraction(resizing, { type: "handle:pointerdown", nodeId: "n1", handle: "s-top" })
  assert.equal(r2.state, resizing, "连线也不能插进来")
  assert.ok(r2.rejected)

  // 同一类交互重复触发是幂等的
  const r3 = reduceInteraction(resizing, { type: "resizer:pointerdown", nodeId: "n1", dir: "w" })
  assert.equal(r3.state.type, "resizing")
  assert.equal(r3.rejected, undefined)
})

test("状态机：pointerup / escape 一律回到 idle", () => {
  const states: Interaction[] = [
    { type: "dragging", nodeIds: ["n1"] },
    { type: "resizing", nodeId: "n1", dir: "se" },
    { type: "connecting", nodeId: "n1", handle: "s-top" },
    { type: "marquee" },
    { type: "edge-menu", edgeId: "e1" },
  ]
  for (const s of states) {
    assert.equal(reduceInteraction(s, { type: "pointerup" }).state.type, "idle", `${s.type} 应回到 idle`)
    assert.equal(reduceInteraction(s, { type: "escape" }).state.type, "idle", `${s.type} 的 escape 应回到 idle`)
  }
})

test("状态机：边菜单打开时画布点击不变成框选", () => {
  const menu: Interaction = { type: "edge-menu", edgeId: "e1" }
  const r = reduceInteraction(menu, { type: "canvas:pointerdown" })
  assert.equal(r.state.type, "edge-menu")
  assert.equal(canStart(menu, "marquee"), false)
})

test("isActive 只对指针进行中的状态为真", () => {
  assert.equal(isActive({ type: "dragging", nodeIds: ["a"] }), true)
  assert.equal(isActive({ type: "resizing", nodeId: "a", dir: "n" }), true)
  assert.equal(isActive({ type: "connecting", nodeId: "a", handle: "s-top" }), true)
  assert.equal(isActive({ type: "idle" }), false)
  assert.equal(isActive({ type: "marquee" }), false)
  assert.equal(isActive({ type: "edge-menu", edgeId: "e1" }), false)
})

test("resize 与状态机组合：向左拉伸全程右边缘不变", () => {
  // 模拟真实拖动的 10 帧
  let state: Interaction = reduceInteraction({ type: "idle" }, { type: "resizer:pointerdown", nodeId: "n1", dir: "w" }).state
  assert.equal(state.type, "resizing")

  const start = { x: 400, y: 300, width: 260, height: 140 }
  let box = start
  for (let i = 0; i < 10; i++) {
    box = resizeNode(box, "w", { dx: -12, dy: 0 }, MIN_SIZE)
    assert.equal(box.x + box.width, start.x + start.width, `第 ${i} 帧右边缘漂移`)
  }
  state = reduceInteraction(state, { type: "pointerup" }).state
  assert.equal(state.type, "idle")
  assert.equal(box.width, 260 + 120)
})

test("卡片节点结构：note 与 message 都携带 id", () => {
  const n: CardNode = { id: "x", position: { x: 0, y: 0 }, card: { kind: "note", id: "x", note: "hi" } }
  assert.equal(n.card.kind, "note")
  assert.equal(n.card.id, "x")
})
