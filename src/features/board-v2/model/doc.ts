/**
 * board-v2 领域模型：唯一的磁盘格式与内存文档格式。
 *
 * 这里只做类型与常量，不含逻辑——逻辑在 map.ts / resize.ts / changes.ts，
 * 全部是纯函数，不 import React，也不碰 DOM。
 */

/** 卡片种类：引用型（消息）与自由型（便签） */
export type CardKind = "message" | "note"

/** 引用型卡片的源 */
export type CardRef = { conversationId: string; messageId: string }

/**
 * 执行历史记录。
 *
 * 直接复用 lib/types 的定义而不是另写一份：历史列表组件（HistoryList）
 * 与既有执行逻辑都基于它，重复定义必然漂移。
 */
import type { NodeRun as LibNodeRun } from "@/lib/types"

export type NodeRun = LibNodeRun

/** 通用卡片字段：两种 kind 共享的用户加工层 */
type CardBase = {
  id: string
  /** 用户改写的标题；空则回落到源消息首行 / 便签首行 */
  title?: string
  /** 用户直接改写的内容，优先于源内容显示 */
  contentOverride?: string
  /** 展开显示全文 */
  expanded?: boolean
  /** 执行历史，最新在前 */
  runs?: NodeRun[]
  /** 颜色标记（色相值） */
  hue?: number
}

/** 引用一条消息的卡片 */
export type MessageCard = CardBase & {
  kind: "message"
  ref: CardRef
  /** 仅摘录部分文字时保存的片段，空则整段引用 */
  excerpt?: string
}

/** 自由便签卡片 */
export type NoteCard = CardBase & {
  kind: "note"
  /** 手写正文（Markdown） */
  note: string
}

export type BoardCard = MessageCard | NoteCard

/** 节点在画布上的几何与层级；尺寸留空表示「由内容自适应」 */
export type CardNode = {
  id: string
  card: BoardCard
  position: { x: number; y: number }
  width?: number
  height?: number
}

export type EdgeKind = "manual" | "reference" | "branch" | "flow"

/** 连线端点：四向手柄的 id，留空表示由框架自动选边 */
export type EdgeAnchor = { nodeId: string; handle: string }

export type BoardEdgeDoc = {
  id: string
  from: EdgeAnchor
  to: EdgeAnchor
  kind: EdgeKind
  /** 该连线携带的提示词；kind=flow 时参与执行 */
  prompt?: string
  /** 是否参与任务执行，undefined 视为 true */
  enabled?: boolean
  /** 线本身的颜色标记 */
  hue?: number
  /** 提示词徽章的独立颜色 */
  promptHue?: number
}

/** 一张画板的全部内容 */
export type BoardDoc = {
  nodes: CardNode[]
  edges: BoardEdgeDoc[]
}

/** 任务：用户显式挑选的一组边，每条边是独立执行单元 */
export type BoardTaskDoc = {
  id: string
  name: string
  edgeIds: string[]
}

export function emptyDoc(): BoardDoc {
  return { nodes: [], edges: [] }
}

/** 尺寸下限：缩放手柄夹紧用 */
export const MIN_SIZE = { width: 160, height: 72 } as const

/** 自适应尺寸时的默认宽度（不写进 doc，仅渲染回落值） */
export const DEFAULT_WIDTH = { message: 260, note: 220 } as const
