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
  AlertCircle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Palette,
  Play,
  ExternalLink,
  FileText,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/markdown"
import { HuePicker } from "@/components/hue-picker"
import { useIsDark } from "@/hooks/use-is-dark"
import { hueBg, hueBorder, hueDot, hueStroke, hueText } from "@/lib/hue"
import type { BoardNodeEntry } from "@/hooks/use-chat-store"
import type { BoardEdge, NodeRun } from "@/lib/types"
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
/* 连线编辑器：浮层，轻量不打断画布操作                                       */

function EdgeEditor({
  edge,
  anchor,
  running,
  onClose,
  onUpdate,
  onToggleKind,
  onToggleEnabled,
  onSetHue,
  onRun,
  onDelete,
}: {
  edge: BoardEdge
  /** 悬浮窗定位点（屏幕坐标），来自点击位置 */
  anchor: { x: number; y: number }
  running: boolean
  onClose: () => void
  onUpdate: (patch: Partial<Pick<BoardEdge, "prompt" | "promptHue">>) => void
  onToggleKind: () => void
  onToggleEnabled: () => void
  onSetHue: (hue: number | undefined) => void
  onRun: () => void
  onDelete: () => void
}) {
  const [prompt, setPrompt] = useState(edge.prompt ?? "")
  const runnable = edge.kind === "flow"

  return (
    // 不用全屏遮罩：点其他线/卡片时可以直接切换，不打断画布操作
    <div
      className="absolute z-20 w-[340px] rounded-xl border border-border bg-card p-3 shadow-xl"
      style={{
        left: Math.min(Math.max(anchor.x + 12, 8), Math.max(window.innerWidth - 360, 8)),
        top: Math.min(Math.max(anchor.y - 24, 8), Math.max(window.innerHeight - 320, 8)),
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
        <div className="mb-2 flex items-center gap-2">
          <Zap
            className={cn(
              "size-4",
              runnable ? "text-primary" : "text-muted-foreground"
            )}
          />
          <span className="flex-1 text-sm font-medium">
            {runnable ? "可执行连线" : "仅联系"}
          </span>
          <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        {runnable ? (
          <>
            <label className="mb-1 block text-[11px] text-muted-foreground">
              这条线要做什么（会与起点材料一起发给模型）
            </label>
            <Textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="这条线要做什么？"
              rows={4}
              className="text-xs"
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            纯视觉联系，不参与任务执行。切换为「可执行」后可以填写提示词。
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">线条颜色</span>
          <HuePicker value={edge.hue} onChange={onSetHue} />
        </div>
        {runnable && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[11px] text-muted-foreground">提示词色</span>
            <HuePicker
              value={edge.promptHue}
              onChange={(h) => onUpdate({ promptHue: h })}
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              onUpdate({ prompt })
              onClose()
            }}
          >
            <Check className="size-3" />
            保存
          </Button>
          {runnable && edge.enabled !== false && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={running}
              onClick={() => {
                // 先存下当前提示词，避免用户改了没保存就执行导致用的是旧值
                onUpdate({ prompt })
                onRun()
              }}
              title="立即执行这一条线（Ctrl/Cmd+Enter）"
            >
              <Play className="size-3" />
              {running ? "执行中…" : "立即执行"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onToggleKind}
          >
            {runnable ? "改为仅联系" : "改为可执行"}
          </Button>
          {runnable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onToggleEnabled}
            >
              {edge.enabled === false ? "启用此线" : "禁用此线"}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3" />
            删除
          </Button>
        </div>
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

/* ------------------------------------------------------------------ */
/* 节点颜色入口：小色点，点开即选                                            */

function NodeHueButton({
  hue,
  onSet,
}: {
  hue?: number
  onSet: (hue: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title="标记颜色"
        aria-label="标记颜色"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          "nodrag flex size-4 items-center justify-center rounded-full border transition-transform hover:scale-110",
          hue === undefined ? "border-dashed border-muted-foreground/50" : "border-transparent"
        )}
        style={hue !== undefined ? { backgroundColor: hueDot(hue) } : undefined}
      >
        {hue === undefined && <Palette className="size-2.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="nodrag absolute right-0 top-5 z-30 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <HuePicker
            value={hue}
            onChange={(h) => {
              onSet(h)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 运行历史：结构化卡片而非裸文本                                          */

function HistoryList({
  runs,
  onApply,
  onClose,
}: {
  runs: NodeRun[]
  onApply: (runId: string) => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div
      data-history
      className="max-h-[260px] shrink-0 overflow-y-auto border-t border-current/10 bg-background/60 p-1.5 backdrop-blur-sm"
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground">
          运行历史 · {runs.length}
        </span>
        <Button variant="ghost" size="icon" className="size-4" onClick={onClose}>
          <X className="size-2.5" />
        </Button>
      </div>

      {runs.map((r) => {
        const isOpen = expanded === r.id
        const fail = !!r.error
        return (
          <div
            key={r.id}
            className={cn(
              "mb-1 overflow-hidden rounded-lg border text-[10px]",
              fail ? "border-destructive/40 bg-destructive/5" : "border-border/70 bg-card"
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-1 px-1.5 py-1 text-left transition-colors hover:bg-muted/50"
              onClick={() => setExpanded(isOpen ? null : r.id)}
            >
              {fail ? (
                <AlertCircle className="size-2.5 shrink-0 text-destructive" />
              ) : (
                <ArrowDownToLine className="size-2.5 shrink-0 text-muted-foreground" />
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatRunTime(r.createdAt)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-medium",
                  fail ? "text-destructive" : "text-foreground/80"
                )}
              >
                {r.prompt || "无提示词"}
              </span>
              {!fail && (
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 rounded px-1 text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    onApply(r.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation()
                      onApply(r.id)
                    }
                  }}
                >
                  回填
                </span>
              )}
            </button>

            {isOpen ? (
              <div className="space-y-1.5 border-t border-border/60 px-1.5 py-1.5">
                {r.inputs.map((inp, i) => (
                  <div key={i}>
                    <div className="mb-0.5 text-[9px] font-medium text-muted-foreground">
                      输入 · {inp.title}
                    </div>
                    <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1 leading-relaxed">
                      {inp.text}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="mb-0.5 text-[9px] font-medium text-muted-foreground">
                    {fail ? "错误" : "输出"}
                  </div>
                  <div
                    className={cn(
                      "max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded p-1 leading-relaxed",
                      fail ? "bg-destructive/10 text-destructive" : "bg-muted/50"
                    )}
                  >
                    {r.error ?? r.output}
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-1.5 pb-1">
                <div
                  className={cn(
                    "line-clamp-2 break-words leading-relaxed",
                    fail ? "text-destructive/90" : "text-muted-foreground"
                  )}
                >
                  {r.error ?? r.output}
                </div>
                <div className="mt-0.5 text-[9px] text-muted-foreground/70">
                  输入 {r.inputs.length} 项 · 点击展开
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 今天只显示时分秒，跨天补日期 */
function formatRunTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hms = d.toLocaleTimeString()
  return sameDay ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms.slice(0, 5)}`
}
