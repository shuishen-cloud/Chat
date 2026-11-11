import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyNodeChanges,
  Background,
  Handle,
  Position,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  History,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/markdown"
import { EdgeEditor } from "@/components/board/edge-editor"
import { NodeHueButton } from "@/components/board/node-hue-button"
import { HistoryList } from "@/components/board/history-list"
import { useIsDark } from "@/hooks/use-is-dark"
import { hueBg, hueBorder, hueStroke, hueText } from "@/lib/hue"
import type { BoardNodeEntry } from "@/hooks/use-chat-store"
import type { BoardEdge } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 节点四向连接点 */
const SIDES = ["top", "right", "bottom", "left"] as const
type Side = (typeof SIDES)[number]
const POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** React Flow 节点上挂的原始数据（用于自定义节点渲染） */
export type BoardNodeData = {
  entry: BoardNodeEntry
  onToggleExpand: (id: string) => void
  onRemove: (id: string) => void
  onJump: (conversationId: string, messageId?: string) => void
  onEditNote: (id: string, text: string) => void
  onResize: (id: string, width: number, height: number) => void
  /** 保存节点内容（写入 contentOverride） */
  onSaveContent: (id: string, text: string) => void
  /** 还原为原文 */
  onRestore: (id: string) => void
  /** 回填某条历史 */
  onApplyRun: (nodeId: string, runId: string) => void
  /** 设置节点颜色 */
  onSetHue: (nodeId: string, hue: number | undefined) => void
  /** 当前是否暗色主题 */
  dark: boolean
}

export type BoardCanvasProps = {
  entries: BoardNodeEntry[]
  edges: BoardEdge[]
  /** 任务选边模式下，点线加入/移出任务 */
  edgeSelectMode: boolean
  /** 当前任务已选的边 */
  selectedEdgeIds: string[]
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onConnect: (
    from: string,
    to: string,
    handles?: { sourceHandle?: string; targetHandle?: string }
  ) => void
  onRemoveNode: (nodeId: string) => void
  onRemoveEdge: (edgeId: string) => void
  onToggleExpand: (nodeId: string) => void
  onJump: (conversationId: string, messageId?: string) => void
  onEditNote: (nodeId: string, text: string) => void
  onResizeNode: (nodeId: string, width: number, height: number) => void
  onSelectionChange: (nodeIds: string[]) => void
  onUpdateEdge: (edgeId: string, patch: Partial<Pick<BoardEdge, "prompt" | "enabled" | "kind">>) => void
  onToggleEdgeKind: (edgeId: string) => void
  onToggleEdgeEnabled: (edgeId: string) => void
  onToggleTaskEdge: (edgeId: string) => void
  onSaveContent: (nodeId: string, text: string) => void
  onRestoreContent: (nodeId: string) => void
  onApplyRun: (nodeId: string, runId: string) => void
  onSetNodeHue: (nodeId: string, hue: number | undefined) => void
  onSetEdgeHue: (edgeId: string, hue: number | undefined) => void
  /** 立即执行单条线 */
  onRunEdge: (edgeId: string) => void
  /** 正在执行的线（用于按钮 loading/禁用） */
  runningEdgeId: string | null
}

export function BoardCanvas(props: BoardCanvasProps) {
  const {
    entries,
    onToggleExpand,
    onRemoveNode,
    onJump,
    onEditNote,
    onResizeNode,
    onSaveContent,
    onRestoreContent,
    onApplyRun,
    onSetNodeHue,
  } = props

  const dark = useIsDark()

  /**
   * 下发给自定义节点的回调集合。
   * 集中成一个对象（而不是每个字段单独传）是因为 React Flow 的 nodeTypes
   * 只在挂载时绑定一次，节点里拿不到外层最新的 props，只能通过 data 传递。
   */
  const data = useMemo(
    () => ({
      onToggleExpand,
      onRemove: onRemoveNode,
      onJump,
      onEditNote,
      onResize: (id: string, width: number, height: number) =>
        onResizeNode(id, width, height),
      onSaveContent,
      onRestore: onRestoreContent,
      onApplyRun,
      onSetHue: onSetNodeHue,
      dark,
    }),
    [
      onToggleExpand,
      onRemoveNode,
      onJump,
      onEditNote,
      onResizeNode,
      onSaveContent,
      onRestoreContent,
      onApplyRun,
      onSetNodeHue,
      dark,
    ]
  )

  // React Flow 的节点 / 连线模型完全由 store 派生，自身不持有业务状态
  const nodes = useMemo<Node<BoardNodeData>[]>(
    () =>
      entries.map((entry) => ({
        id: entry.node.id,
        type: entry.node.kind === "note" ? "note" : "message",
        position: { x: entry.node.x, y: entry.node.y },
        ...(entry.node.width && entry.node.height
          ? { width: entry.node.width, height: entry.node.height }
          : {}),
        data: { entry, ...data },
      })),
    [entries, data]
  )

  return (
    <ReactFlowProvider>
      <InnerFlow {...props} nodes={nodes} />
    </ReactFlowProvider>
  )
}

function InnerFlow({
  nodes,
  edges,
  edgeSelectMode,
  selectedEdgeIds,
  onMoveNode,
  onConnect,
  onRemoveEdge,
  onSelectionChange,
  onUpdateEdge,
  onToggleEdgeKind,
  onToggleEdgeEnabled,
  onToggleTaskEdge,
  onRunEdge,
  onSetEdgeHue,
  runningEdgeId,
}: BoardCanvasProps & { nodes: Node<BoardNodeData>[] }) {
  const dark = useIsDark()
  // 只定义一次；键名对应 BoardNodeData 里的 kind
  const nodeTypes = useMemo<NodeTypes>(
    () => ({ message: MessageNode, note: NoteNode }),
    []
  )

  /** 是否正在拉线：拉线过程中才让节点表面成为落点 */
  const [connecting, setConnecting] = useState(false)

  /**
   * 正在执行的边 id 集合。
   * 当前为串行执行，同一时刻最多一条；仍按数组处理，为将来并发留余地。
   */
  const runningEdgeIds = useMemo(
    () =>
      runningEdgeId?.startsWith("edge:")
        ? [runningEdgeId.slice("edge:".length)]
        : [],
    [runningEdgeId]
  )

  /*
   * 受控模式下必须提供 onNodesChange，否则 React Flow 内部的选中变更
   * （select 类型）无处落地，节点永远进不了 selected 状态，
   * 表现为：点了卡片没有选中框、NodeResizer 不出现、框选也不工作。
   * 这里只接受 select / dimensions 这类内部变更，position 由我们自己的
   * 拖拽逻辑负责，避免与 store 的坐标来源冲突。
   */
  const [localNodes, setLocalNodes] = useState<Node<BoardNodeData>[]>(nodes)
  const nodesRef = useRef(nodes)
  useEffect(() => {
    const prevSelected = new Set(
      nodesRef.current.filter((n) => n.selected).map((n) => n.id)
    )
    nodesRef.current = nodes
    setLocalNodes(
      nodes.map((n) =>
        prevSelected.has(n.id) && n.selected === undefined
          ? { ...n, selected: true }
          : n
      )
    )
  }, [nodes])

  /**
   * 只接受「选中/尺寸」类变更（如 Resize 手柄拖动）。
   *
   * 位置变更由下面的拖拽逻辑自己接管（先本地跟手、松手才写库），
   * 增删则由 store 统一管理；放行它们会和 store 双向打架导致抖动。
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<BoardNodeData>>[]) => {
      const accepted = changes.filter(
        (c) => c.type !== "position" && c.type !== "remove" && c.type !== "add"
      )
      if (accepted.length === 0) return
      setLocalNodes((prev) => {
        const next = applyNodeChanges(accepted, prev)
        nodesRef.current = next
        return next
      })
    },
    []
  )

  /*
   * 拖拽必须本地跟在手上，不能等 store 回车。
   * 受控模式下中途不更新会让 React Flow 每次内部渲染都用旧坐标把节点拽回原位。
   */
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({})

  const displayNodes = useMemo(() => {
    const keys = Object.keys(dragging)
    if (keys.length === 0) return localNodes
    return localNodes.map((n) =>
      dragging[n.id] ? { ...n, position: dragging[n.id] } : n
    )
  }, [localNodes, dragging])

  const handleDrag = useCallback((_: unknown, node: Node) => {
    setDragging((prev) => {
      const cur = prev[node.id]
      if (cur && cur.x === node.position.x && cur.y === node.position.y) return prev
      return { ...prev, [node.id]: { x: node.position.x, y: node.position.y } }
    })
  }, [])

  const handleDragStart = useCallback((_: unknown, node: Node) => {
    setDragging((prev) => ({
      ...prev,
      [node.id]: { x: node.position.x, y: node.position.y },
    }))
  }, [])

  const handleDragStop = useCallback(
    (_: unknown, node: Node) => {
      onMoveNode(node.id, node.position.x, node.position.y)
      setDragging((prev) => {
        if (!prev[node.id]) return prev
        const next = { ...prev }
        delete next[node.id]
        return next
      })
    },
    [onMoveNode]
  )

  /** 选区回调只在内容真变时向上通知，避免循环渲染 */
  const lastSelectedRef = useRef<string>("")
  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) => {
      const ids = selected.map((n) => n.id)
      const key = ids.join("|")
      if (key === lastSelectedRef.current) return
      lastSelectedRef.current = key
      onSelectionChange(ids)
    },
    [onSelectionChange]
  )

  /**
   * 领域边（BoardEdge）→ React Flow 边。
   *
   * 状态全部落在 className 上，由 CSS 控制样式：
   * 执行中的流动动画、禁用淡化、选中高亮、批量选择时的可点态。
   * 颜色直接用 inline style 覆盖，因为 hue 是运行时值，写不进 CSS 类。
   */
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const runnable = e.kind === "flow"
        const disabled = runnable && e.enabled === false
        const selected = selectedEdgeIds.includes(e.id)
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: e.sourceHandle ?? "s-bottom",
          targetHandle: e.targetHandle ?? "t-top",
          type: "default",
          // 线上的提示词徽章
          label: runnable ? e.prompt?.trim() || "未设置提示词" : e.label,
          animated: e.kind === "reference",
          className: cn(
            runnable && "board-edge-flow",
            disabled && "board-edge-disabled",
            selected && "board-edge-selected",
            edgeSelectMode && "board-edge-selectable",
            runningEdgeIds.includes(e.id) && "board-edge-executing"
          ),
          labelClassName: cn(
            "board-edge-label",
            runnable && e.promptHue === undefined && "board-edge-label-flow",
            disabled && "board-edge-label-disabled",
            selected && "board-edge-label-selected"
          ),
          labelStyle:
            e.promptHue !== undefined
              ? { fill: hueStroke(e.promptHue, dark) }
              : undefined,
          markerEnd: { type: "arrowclosed" as const, width: 16, height: 16 },
          // 有标记色时用色相覆盖默认主题色
          style: e.hue !== undefined ? { stroke: hueStroke(e.hue, dark) } : undefined,
          data: { kind: e.kind },
        }
      }),
    [edges, selectedEdgeIds, edgeSelectMode, dark, runningEdgeIds]
  )

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      onConnect(c.source, c.target, {
        sourceHandle: c.sourceHandle ?? undefined,
        targetHandle: c.targetHandle ?? undefined,
      })
    },
    [onConnect]
  )

  /** 点线：选边模式下加入任务，否则打开提示词编辑器 */
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  /** 编辑器悬浮位置：跟随点击处 */
  const [edgeAnchor, setEdgeAnchor] = useState({ x: 0, y: 0 })

  /** 最近点选过的边：供 Enter 快捷键执行 */
  const lastEdgeRef = useRef<string | null>(null)
  /** 键盘监听里需要最新 onRunEdge，用 ref 避免反复解绑 */
  const runEdgeRef = useRef(onRunEdge)
  useEffect(() => {
    runEdgeRef.current = onRunEdge
  }, [onRunEdge])
  /** 边编辑器打开时按 Esc 关闭 */
  const closeEditor = useCallback(() => setEditingEdgeId(null), [])

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const source = edges.find((e) => e.id === edge.id)
      if (edgeSelectMode) {
        // 只有可执行的线才能选进任务
        if (source?.kind === "flow") onToggleTaskEdge(edge.id)
        return
      }
      lastEdgeRef.current = edge.id
      // 用屏幕坐标定位悬浮窗；拿不到事件时退回相对位置
      const rect = (event?.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
      setEdgeAnchor(
        rect
          ? { x: rect.left + rect.width / 2, y: rect.top }
          : { x: window.innerWidth / 2, y: 160 }
      )
      setEditingEdgeId(edge.id)
    },
    [edgeSelectMode, edges, onToggleTaskEdge]
  )

  /*
   * 键盘执行：选中一条线后按 Enter 或 Ctrl/Cmd+Enter 立即执行。
   * 输入框/文本域内不拦截，避免影响边提示词编辑。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName.toLowerCase()
      const typing =
        tag === "input" || tag === "textarea" || el?.isContentEditable === true

      if (e.key === "Escape") {
        if (editingEdgeId) {
          closeEditor()
          e.preventDefault()
        }
        return
      }

      if (e.key !== "Enter") return
      const edgeId = lastEdgeRef.current
      if (!edgeId) return

      // 在编辑器里且非 Control/Cmd 时，走编辑器自己的保存逻辑
      const withMod = e.metaKey || e.ctrlKey
      if (typing && !withMod) return
      if (!typing && !withMod) {
        // 纯 Enter：仅当焦点不在输入框时执行，避免误触
      }

      e.preventDefault()
      runEdgeRef.current?.(edgeId)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editingEdgeId, closeEditor])

  const editingEdge = edges.find((e) => e.id === editingEdgeId) ?? null

  return (
    <div
      className={cn(
        "relative h-full w-full",
        connecting && "board-connecting cursor-crosshair"
      )}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleDragStart}
        onNodeDrag={handleDrag}
        onNodeDragStop={handleDragStop}
        onConnect={handleConnect}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={() => setConnecting(false)}
        connectionMode={ConnectionMode.Loose}
        onEdgeClick={handleEdgeClick}
      onEdgeDoubleClick={(_, edge) => onRunEdge(edge.id)}
        onEdgesDelete={(removed) => removed.forEach((e) => onRemoveEdge(e.id))}
        onSelectionChange={handleSelectionChange}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={null}
        nodeDragThreshold={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-muted" />
      </ReactFlow>

      {editingEdge && (
        <EdgeEditor
          edge={editingEdge}
          anchor={edgeAnchor}
          running={runningEdgeId === `edge:${editingEdge.id}`}
          onClose={() => setEditingEdgeId(null)}
          onUpdate={(patch) => onUpdateEdge(editingEdge.id, patch)}
          onToggleKind={() => onToggleEdgeKind(editingEdge.id)}
          onToggleEnabled={() => onToggleEdgeEnabled(editingEdge.id)}
          onSetHue={(hue) => onSetEdgeHue(editingEdge.id, hue)}
          onRun={() => onRunEdge(editingEdge.id)}
          onDelete={() => {
            onRemoveEdge(editingEdge.id)
            setEditingEdgeId(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * 四向连接点。
 *
 * 手柄的视觉很小（7px），但通过 CSS 的 ::after 把命中区扩到约 26px，
 * 配合 connectionMode=Loose（不要求 source→target 方向匹配），
 * 拉线时不必精确对准那个小点。
 */
function NodeHandles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={`t-${side}`}
          id={`t-${side}`}
          type="target"
          position={POSITION[side]}
          className="board-handle"
        />
      ))}
      {SIDES.map((side) => (
        <Handle
          key={`s-${side}`}
          id={`s-${side}`}
          type="source"
          position={POSITION[side]}
          className="board-handle board-handle-source"
        />
      ))}

    </>
  )
}

function MessageNode({ data, selected }: NodeProps<Node<BoardNodeData>>) {
  const {
    entry,
    onToggleExpand,
    onRemove,
    onJump,
    onResize,
    onSaveContent,
    onRestore,
    onApplyRun,
    onSetHue,
    dark,
  } = data
  const { node, conversation, message, text } = entry
  const expanded = !!node.expanded
  const isUser = message?.role === "user"
  const sized = !!(node.width && node.height)
  const overridden = node.contentOverride !== undefined && node.contentOverride !== ""

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [showHistory, setShowHistory] = useState(false)
  const runs = node.runs ?? []

  const startEdit = () => {
    setDraft(node.contentOverride ?? text)
    setEditing(true)
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow",
        !sized && "w-[260px]",
        selected && "ring-2 ring-primary/30",
        !selected && node.hue === undefined && "border-border",
        isUser && !overridden && node.hue === undefined && "bg-secondary/40"
      )}
      style={{
        ...(node.hue !== undefined
          ? { borderColor: hueBorder(node.hue, dark), backgroundColor: hueBg(node.hue, dark) }
          : {}),
        ...(sized ? { width: "100%", height: "100%" } : {}),
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={80}
        lineClassName="!border-primary/60"
        handleClassName="!size-2 !rounded-sm !border-primary !bg-background"
        onResizeEnd={(_, p) => onResize(node.id, Math.round(p.width), Math.round(p.height))}
      />
      <NodeHandles />
      <ConnectingSurface />

      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
            isUser ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
          )}
        >
          {isUser ? "我" : "DS"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {node.title || conversation?.title || "来源对话"}
        </span>
        <NodeHueButton hue={node.hue} onSet={(h) => onSetHue(node.id, h)} />
        {overridden && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-600 dark:text-amber-400">
            已改写
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5 opacity-50 transition-opacity hover:opacity-100">
          {runs.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => setShowHistory((v) => !v)}
              title="历史"
            >
              <History className="size-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={startEdit}
            title="编辑内容"
          >
            <Pencil className="size-3" />
          </Button>
          {overridden && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => onRestore(node.id)}
              title="还原为原文"
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
          {conversation && message && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => onJump(conversation.id, message.id)}
              title="回到原消息"
            >
              <ExternalLink className="size-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={() => onToggleExpand(node.id)}
            title={expanded ? "收起" : "展开全文"}
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 hover:text-destructive"
            onClick={() => onRemove(node.id)}
            title="从画板移除"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="nodrag min-h-0 flex-1 resize-none text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => {
                onSaveContent(node.id, draft)
                setEditing(false)
              }}
              title="保存"
            >
              <Check className="size-3" />
              保存
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "px-2.5 py-2 text-xs",
            sized
              ? "min-h-0 flex-1 overflow-y-auto"
              : expanded
                ? "max-h-[420px] overflow-y-auto"
                : "max-h-[132px] overflow-hidden"
          )}
        >
          {!isUser && message ? (
            <Markdown content={text} className="prose-chat text-xs leading-relaxed" />
          ) : (
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">
              {text}
            </div>
          )}
        </div>
      )}

      {node.note && (
        <div className="border-t border-border/60 bg-amber-500/5 px-2.5 py-1.5 text-[11px] whitespace-pre-wrap text-amber-700 dark:text-amber-300">
          {node.note}
        </div>
      )}

      {showHistory && runs.length > 0 && (
        <HistoryList
          runs={runs}
          onApply={(runId) => onApplyRun(node.id, runId)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

function NoteNode({ data, selected }: NodeProps<Node<BoardNodeData>>) {
  const {
    entry,
    onRemove,
    onEditNote,
    onApplyRun,
    onResize,
    onSetHue,
    onRestore: onRestoreNote,
    dark,
  } = data
  const { node } = entry
  const sized = !!(node.width && node.height)
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const runs = node.runs ?? []
  /**
   * 便签正文：执行结果（contentOverride）优先于手写内容。
   * 这样线跑完结果直接显示在便签里，而不是只躺在历史里。
   */
  const body = node.contentOverride ?? node.note ?? ""
  const produced = node.contentOverride !== undefined && node.contentOverride !== ""

  const startEdit = () => {
    setDraft(body)
    setEditing(true)
  }

  /** 退出编辑并落盘；内容无变化则不写，避免无谓的 state 更新 */
  const commit = () => {
    if (draft !== body) onEditNote(node.id, draft)
    setEditing(false)
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border shadow-sm",
        !sized && "w-[220px]",
        selected ? "ring-2 ring-amber-500/30" : "",
        node.hue === undefined &&
          "bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100",
        node.hue === undefined &&
          (selected ? "border-amber-500" : "border-amber-300/70 dark:border-amber-800")
      )}
      style={{
        ...(node.hue !== undefined
          ? {
              borderColor: hueBorder(node.hue, dark),
              backgroundColor: hueBg(node.hue, dark),
              color: hueText(node.hue, dark),
            }
          : {}),
        ...(sized ? { width: "100%", height: "100%" } : {}),
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={80}
        lineClassName="!border-amber-500/60"
        handleClassName="!size-2 !rounded-sm !border-amber-500 !bg-background"
        onResizeEnd={(_, p) => onResize(node.id, Math.round(p.width), Math.round(p.height))}
      />
      <NodeHandles />
      <ConnectingSurface />

      <div className="flex items-center gap-1.5 border-b border-current/10 px-2.5 py-1.5">
        <FileText className="size-3 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {node.title || "便签"}
        </span>
        {produced && (
          <span className="shrink-0 rounded bg-current/10 px-1 text-[9px] opacity-70">
            已产出
          </span>
        )}
        <NodeHueButton hue={node.hue} onSet={(h) => onSetHue(node.id, h)} />
        {runs.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-current opacity-50 hover:bg-transparent hover:opacity-100"
            onClick={() => setShowHistory((v) => !v)}
            title="历史"
          >
            <History className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-current opacity-50 hover:bg-transparent hover:opacity-100"
          onClick={() => onRemove(node.id)}
          title="删除便签"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              commit()
            }
          }}
          rows={4}
          placeholder="写点什么…（支持 Markdown）"
          className={cn(
            "nodrag resize-none bg-transparent px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:opacity-50",
            sized ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[220px] overflow-y-auto"
          )}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") startEdit()
          }}
          className={cn(
            "nodrag cursor-text px-2.5 py-2 text-xs leading-relaxed",
            sized ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[220px] overflow-y-auto",
            !body && "text-current/50"
          )}
        >
          {body ? (
            <Markdown content={body} className="prose-chat text-xs leading-relaxed" />
          ) : (
            "点击写点什么…（支持 Markdown）"
          )}
        </div>
      )}

      {produced && (
        <div className="flex shrink-0 items-center gap-1 border-t border-current/10 px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1 text-[10px] text-current opacity-60 hover:bg-transparent hover:opacity-100"
            onClick={() => onRestoreNote(node.id)}
            title="清空产出，回到手写内容"
          >
            <RotateCcw className="size-2.5" />
            退回手写内容
          </Button>
        </div>
      )}

      {showHistory && runs.length > 0 && (
        <HistoryList
          runs={runs}
          onApply={(runId) => onApplyRun(node.id, runId)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

/**
 * 落点层：拖线过程中覆盖整个节点，让"松手落在节点任意位置"都能接上。
 * 非拉线状态下 pointer-events: none，不影响节点的选择与拖动。
 */
function ConnectingSurface() {
  return (
    <Handle
      id="t-surface"
      type="target"
      position={Position.Top}
      className="board-handle board-handle-surface"
    />
  )
}
