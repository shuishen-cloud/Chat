/**
 * 领域模型 ↔ React Flow 模型的可逆映射。
 *
 * 设计约定（见 doc/feat/board-v2-rewrite.md）：
 *  - 业务字段全部放进 `data.card`，框架字段（position/size/selected）归框架；
 *  - 映射必须是**可逆**的：fromFlow(toFlow(doc)) 与 doc 字段级等价；
 *  - 纯函数：不读全局、不写 ref、不 import React 运行时（仅类型）。
 */
import type { Edge, Node } from "@xyflow/react"

import type { BoardDoc, BoardEdgeDoc, CardNode, EdgeKind } from "./doc.ts"

/** 卡片组件从 `data` 里读到的东西 */
export type CardData = {
  card: CardNode["card"]
  /**
   * 尺寸已被用户显式设置。
   *
   * 必须显式记录，不能靠「node.width 是否等于 measured」推断：
   * React Flow 在非受控模式下会把量测尺寸写进 width/height，
   * 两者无法区分，正是 v1 尺寸语义混乱的来源。
   */
  explicitSize?: boolean
  /** 渲染所需的外部上下文（消息正文等）由视图层注入 */
  source?: { text: string; title: string; role: "user" | "assistant" }
  /** 当前是否暗色主题：颜色计算用 */
  dark?: boolean
}

export type RtNode = Node<CardData, "card">
export type RtEdge = Edge<{ kind: EdgeKind }>

export const FLOW_NODE_TYPE = "card" as const

/** 领域节点 → React Flow 节点 */
export function toFlowNode(node: CardNode, extra?: Omit<CardData, "card">): RtNode {
  const explicit = node.width !== undefined && node.height !== undefined
  const out: RtNode = {
    id: node.id,
    type: FLOW_NODE_TYPE,
    position: { x: node.position.x, y: node.position.y },
    data: { card: node.card, explicitSize: explicit, ...extra },
  }
  if (explicit) {
    out.width = node.width
    out.height = node.height
    // 固定尺寸后 React Flow 不再自动量测，避免「量测值覆盖用户设置」
    out.style = { width: node.width, height: node.height }
  }
  return out
}

/** 领域文档 → React Flow 节点数组 */
export function toFlow(doc: BoardDoc, extraFor?: (n: CardNode) => Omit<CardData, "card">): RtNode[] {
  return doc.nodes.map((n) => toFlowNode(n, extraFor?.(n)))
}

/** 领域边 → React Flow 边 */
export function toFlowEdge(edge: BoardEdgeDoc): RtEdge {
  return {
    id: edge.id,
    source: edge.from.nodeId,
    target: edge.to.nodeId,
    sourceHandle: edge.from.handle || undefined,
    targetHandle: edge.to.handle || undefined,
    data: { kind: edge.kind },
  }
}

export function toFlowEdges(doc: BoardDoc): RtEdge[] {
  return doc.edges.map(toFlowEdge)
}

/** React Flow 节点 → 领域节点（忽略框架附加字段） */
export function fromFlowNode(node: RtNode): CardNode {
  const out: CardNode = {
    id: node.id,
    card: node.data.card,
    position: { x: node.position.x, y: node.position.y },
  }
  // 只有显式设置过尺寸的节点才写回 width/height；
  // 其余情况（含框架量测值）一律视为「自适应」，不落盘。
  if (node.data.explicitSize && node.width !== undefined && node.height !== undefined) {
    out.width = node.width
    out.height = node.height
  }
  return out
}

export function fromFlowEdge(edge: RtEdge): BoardEdgeDoc {
  return {
    id: edge.id,
    from: { nodeId: edge.source, handle: edge.sourceHandle ?? "" },
    to: { nodeId: edge.target, handle: edge.targetHandle ?? "" },
    kind: edge.data?.kind ?? "manual",
  }
}

/**
 * React Flow → 领域文档。
 *
 * `prev` 提供框架无法承载的字段（prompt / enabled / hue 等），
 * 按 id 合并回来，保证「渲染 → 存储」不丢业务数据。
 */
export function fromFlow(nodes: RtNode[], edges: RtEdge[], prev: BoardDoc): BoardDoc {
  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]))
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]))

  return {
    nodes: nodes.map((n) => {
      const next = fromFlowNode(n)
      const old = prevNodes.get(n.id)
      // 卡片上的业务字段以节点 data 为准（卡片自身会更新它）
      return old ? { ...next, card: next.card ?? old.card } : next
    }),
    edges: edges.map((e) => {
      const next = fromFlowEdge(e)
      const old = prevEdges.get(e.id)
      if (!old) return next
      /*
       * 只搬运「确实存在」的业务字段。
       * 不能直接 `{...next, prompt: old.prompt}`：当旧值不存在时会把
       * `prompt: undefined` 写成自有属性，导致往返等价比较失败，
       * 也会让序列化结果多出一堆 null/undefined 键。
       */
      const merged: BoardEdgeDoc = { ...next, kind: old.kind }
      if (old.prompt !== undefined) merged.prompt = old.prompt
      if (old.enabled !== undefined) merged.enabled = old.enabled
      if (old.hue !== undefined) merged.hue = old.hue
      if (old.promptHue !== undefined) merged.promptHue = old.promptHue
      return merged
    }),
  }
}
