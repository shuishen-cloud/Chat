/**
 * store 适配层：把既有 store 的 BoardNode / BoardEdge 投影成 BoardDoc，
 * 并把画布回调翻译回 store 的既有方法。
 *
 * 放这一层的理由：`view/` 不该知道 store 的形状，`model/` 更不该。
 * 所有「形状转换」集中在这一个文件，便于以后 store 改形状时只改这里。
 */
import type {
  BoardEdge as StoreEdge,
  BoardNode as StoreNode,
  Message,
  Conversation,
} from "@/lib/types"
import type { BoardCard, BoardDoc, CardNode, EdgeKind, NodeRun } from "./model/doc"

/** 引用型卡片需要的外部上下文，由 store 侧提供 */
export type SourceLookup = {
  conversationOf: (conversationId: string) => Conversation | undefined
}

/** store 节点 → 领域卡片 */
function cardOf(node: StoreNode): BoardCard {
  const base = {
    id: node.id,
    title: node.title,
    contentOverride: node.contentOverride,
    expanded: node.expanded,
    runs: node.runs as NodeRun[] | undefined,
    hue: node.hue,
  }
  if (node.kind === "note") {
    return { kind: "note", note: node.note ?? "", ...base }
  }
  return {
    kind: "message",
    ref: {
      conversationId: node.ref?.conversationId ?? "",
      messageId: node.ref?.messageId ?? "",
    },
    excerpt: node.excerpt,
    ...base,
  }
}

/** store 边 → 领域边 */
function edgeOf(edge: StoreEdge): BoardDoc["edges"][number] {
  return {
    id: edge.id,
    from: { nodeId: edge.from, handle: edge.sourceHandle ?? "" },
    to: { nodeId: edge.to, handle: edge.targetHandle ?? "" },
    kind: edge.kind as EdgeKind,
    prompt: edge.prompt,
    enabled: edge.enabled,
    hue: edge.hue,
    promptHue: edge.promptHue,
  }
}

/** store 的一板数据 → 领域文档 */
export function toDoc(nodes: StoreNode[], edges: StoreEdge[], boardId: string): BoardDoc {
  return {
    nodes: nodes
      .filter((n) => n.boardId === boardId)
      .map((n): CardNode => {
        const out: CardNode = {
          id: n.id,
          card: cardOf(n),
          position: { x: n.x, y: n.y },
        }
        if (n.width !== undefined && n.height !== undefined) {
          out.width = n.width
          out.height = n.height
        }
        return out
      }),
    edges: edges.filter((e) => e.boardId === boardId).map(edgeOf),
  }
}

/** 领域边 → store 边的补丁（只保留几何与 kind；其余字段由 store 原有值保留） */
export function edgePatchOf(edge: BoardDoc["edges"][number]) {
  return {
    from: edge.from.nodeId,
    to: edge.to.nodeId,
    sourceHandle: edge.from.handle || undefined,
    targetHandle: edge.to.handle || undefined,
  }
}

/** 消息正文：摘录优先，否则源消息内容 */
export function messageTextOf(node: StoreNode, message: Message | undefined): string {
  return node.excerpt || message?.content || ""
}
