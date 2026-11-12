/**
 * board-v2 对外出口。
 *
 * 对外只暴露一个 `BoardView`：接 store、投影文档、把回调翻译回去。
 * 内部结构（model / interaction / view）不对外泄漏，
 * 这样以后调整内部实现不会波及调用方。
 */
import { useCallback, useMemo } from "react"

import type { ChatStore } from "@/hooks/use-chat-store"
import type { BoardCard, BoardDoc } from "./model/doc"
import { toDoc } from "./store-adapter"
import { BoardCanvas } from "./view/board-canvas"
import type { Interaction } from "./interaction/machine"

/* 类型与纯函数从方框外导出，避免本文件同时导出组件与非组件（Fast Refresh） */
export type { BoardDoc } from "./model/doc"

/**
 * 画板视图。
 *
 * 职责边界：
 *  - 把 store 的节点/边投影成 BoardDoc（每次 store 变化重算，无本地副本）；
 *  - 把画布回调翻译成 store 方法调用。
 * 不持有画板的业务状态。
 */
export function BoardView({
  store,
  boardId,
  dark,
  edgePickMode,
  selectedEdgeIds,
  executingEdgeId,
  onEdgePick,
  onEdgeClick,
  onEdgeRun,
  editingEdgeId,
  onConnectCheck,
  onInteractionChange,
}: {
  store: ChatStore
  boardId: string
  dark: boolean
  /** 选边模式：点线加入/移出任务 */
  edgePickMode?: boolean
  /** 当前任务已选的边 */
  selectedEdgeIds?: string[]
  /** 正在执行的边（"edge:xxx" 里的 xxx） */
  executingEdgeId?: string | null
  /** 正在编辑的边（悬浮编辑器打开中） */
  editingEdgeId?: string | null
  onEdgePick?: (edgeId: string) => void
  /** 点线：交给上层打开边编辑器 */
  /** 长按线：打开编辑器；anchor 是屏幕上真实的按下点 */
  onEdgeClick: (edgeId: string, anchor: { x: number; y: number }) => void
  /** 短按线：执行这条线（长按才编辑） */
  onEdgeRun?: (edgeId: string) => void
  /** 连线前校验（可选，例如禁止自环） */
  onConnectCheck?: (fromId: string, toId: string) => boolean
  onInteractionChange?: (state: Interaction) => void
}) {
  const { boardNodeEntries } = store
  const { boardNodes, boardEdges } = store.state

  /**
   * 文档完全由 store 派生。
   *
   * 这里没有 useState 副本：store 变了就重算，画布把 store 当唯一真值。
   * 几何变更会先经过画布内的 React Flow store，提交时再回写 store，
   * 因此不会出现「两份坐标互相覆盖」。
   */
  const doc = useMemo<BoardDoc>(
    () => toDoc(boardNodes, boardEdges, boardId),
    [boardNodes, boardEdges, boardId]
  )

  /** 卡片 id → 源消息上下文（供卡片渲染标题/正文/角色） */
  const sourceById = useMemo(() => {
    const map = new Map<string, { text: string; title: string; role: "user" | "assistant" }>()
    for (const e of boardNodeEntries) {
      if (e.node.kind !== "message" || !e.message) continue
      map.set(e.node.id, {
        text: e.text,
        title: e.conversation?.title || "来源对话",
        role: e.message.role,
      })
    }
    return map
  }, [boardNodeEntries])

  /** 便签没有源消息；用空文本占位，卡片自己会显示 placeholder */
  const sourceOf = useCallback(
    (card: BoardCard) => sourceById.get(card.id),
    [sourceById]
  )

  /**
   * 几何落库。
   *
   * 画布只在拖拽/缩放结束时调用这里，所以写入频率很低。
   * 位置用 moveNode、尺寸用 updateNode，保持与既有 store 语义一致。
   */
  const handleDocChange = useCallback(
    (next: BoardDoc) => {
      const prevById = new Map(doc.nodes.map((n) => [n.id, n]))
      for (const n of next.nodes) {
        const prev = prevById.get(n.id)
        if (!prev) continue
        const moved = prev.position.x !== n.position.x || prev.position.y !== n.position.y
        const resized = prev.width !== n.width || prev.height !== n.height
        if (moved) store.moveNode(n.id, n.position.x, n.position.y)
        if (resized) {
          store.updateNode(n.id, {
            width: n.width ?? (undefined as unknown as number),
            height: n.height ?? (undefined as unknown as number),
          })
        }
      }

      // 边被删除（框选后 Delete / 画布删除）
      const nextEdgeIds = new Set(next.edges.map((e) => e.id))
      for (const e of doc.edges) {
        if (!nextEdgeIds.has(e.id)) store.removeEdge(e.id)
      }
    },
    [doc, store]
  )

  /** 卡片动作：统一按 id 调 store */
  const actions = useMemo(
    () => ({
      onRemove: (id: string) => store.removeNodes([id]),
      onToggleExpand: (id: string) => {
        const node = boardNodes.find((n) => n.id === id)
        store.updateNode(id, { expanded: !node?.expanded })
      },
      onSaveContent: (id: string, text: string) => store.updateNode(id, { contentOverride: text }),
      onRestore: (id: string) => store.restoreNodeContent(id),
      onApplyRun: (id: string, runId: string) => store.applyRun(id, runId),
      onSetHue: (id: string, hue: number | undefined) => store.setNodeHue(id, hue),
      onJump: (id: string) => {
        const entry = boardNodeEntries.find((e) => e.node.id === id)
        const ref = entry?.node.ref
        if (ref) store.jumpToMessage(ref.conversationId, ref.messageId)
      },
    }),
    [store, boardNodes, boardNodeEntries]
  )

  const handleConnect = useCallback(
    (from: { nodeId: string; handle: string }, to: { nodeId: string; handle: string }) => {
      if (onConnectCheck && !onConnectCheck(from.nodeId, to.nodeId)) return
      store.connectNodes(from.nodeId, to.nodeId, {
        sourceHandle: from.handle || undefined,
        targetHandle: to.handle || undefined,
      })
    },
    [store, onConnectCheck]
  )

  /** 边点击：把按下点一起交给上层，悬浮窗才能贴着手指出现 */
  const handleEdgeClick = useCallback(
    (edgeId: string, anchor: { x: number; y: number }) => {
      onEdgeClick(edgeId, anchor)
    },
    [onEdgeClick]
  )

  return (
    <BoardCanvas
      doc={doc}
      sourceOf={sourceOf}
      actions={actions}
      dark={dark}
      edgePickMode={edgePickMode}
      selectedEdgeIds={selectedEdgeIds}
      executingEdgeId={executingEdgeId}
      onEdgePick={onEdgePick}
      onDocChange={handleDocChange}
      editingEdgeId={editingEdgeId}
      onEdgeClick={handleEdgeClick}
      onEdgeRun={onEdgeRun}
      onConnect={handleConnect}
      onInteractionChange={onInteractionChange}
    />
  )
}
