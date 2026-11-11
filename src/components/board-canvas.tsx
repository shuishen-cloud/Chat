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
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/markdown"
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
  } = props

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
}: BoardCanvasProps & { nodes: Node<BoardNodeData>[] }) {
  const nodeTypes = useMemo<NodeTypes>(
    () => ({ message: MessageNode, note: NoteNode }),
    []
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
            edgeSelectMode && "board-edge-selectable"
          ),
          labelClassName: cn(
            "board-edge-label",
            runnable && "board-edge-label-flow",
            disabled && "board-edge-label-disabled",
            selected && "board-edge-label-selected"
          ),
          markerEnd: { type: "arrowclosed" as const, width: 16, height: 16 },
          data: { kind: e.kind },
        }
      }),
    [edges, selectedEdgeIds, edgeSelectMode]
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

  const handleEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      const source = edges.find((e) => e.id === edge.id)
      if (edgeSelectMode) {
        // 只有可执行的线才能选进任务
        if (source?.kind === "flow") onToggleTaskEdge(edge.id)
        return
      }
      setEditingEdgeId(edge.id)
    },
    [edgeSelectMode, edges, onToggleTaskEdge]
  )

  const editingEdge = edges.find((e) => e.id === editingEdgeId) ?? null

  return (
    <>
      <ReactFlow
        nodes={displayNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleDragStart}
        onNodeDrag={handleDrag}
        onNodeDragStop={handleDragStop}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
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
          onClose={() => setEditingEdgeId(null)}
          onUpdate={(patch) => onUpdateEdge(editingEdge.id, patch)}
          onToggleKind={() => onToggleEdgeKind(editingEdge.id)}
          onToggleEnabled={() => onToggleEdgeEnabled(editingEdge.id)}
          onDelete={() => {
            onRemoveEdge(editingEdge.id)
            setEditingEdgeId(null)
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 连线编辑器：浮层，轻量不打断画布操作                                       */

function EdgeEditor({
  edge,
  onClose,
  onUpdate,
  onToggleKind,
  onToggleEnabled,
  onDelete,
}: {
  edge: BoardEdge
  onClose: () => void
  onUpdate: (patch: Partial<Pick<BoardEdge, "prompt">>) => void
  onToggleKind: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}) {
  const [prompt, setPrompt] = useState(edge.prompt ?? "")
  const runnable = edge.kind === "flow"

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-[360px] rounded-xl border border-border bg-card p-3 shadow-lg"
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
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 四向连接点：每边一个 source + 一个 target */
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
      style={sized ? { width: "100%", height: "100%" } : undefined}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow",
        !sized && "w-[260px]",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
        isUser && !overridden ? "bg-secondary/40" : "bg-card"
      )}
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
        <div className="max-h-[240px] shrink-0 overflow-y-auto border-t border-border/60 bg-muted/40 p-1.5">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] font-medium text-muted-foreground">
              运行历史 {runs.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-4"
              onClick={() => setShowHistory(false)}
            >
              <X className="size-2.5" />
            </Button>
          </div>
          {runs.map((r) => (
            <div
              key={r.id}
              className="mb-1 rounded-md border border-border/60 bg-background/70 px-1.5 py-1"
            >
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>{new Date(r.createdAt).toLocaleTimeString()}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.prompt || "无提示词"}
                </span>
                {!r.error && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-[10px] text-primary hover:underline"
                    onClick={() => onApplyRun(node.id, r.id)}
                    title="回填到当前内容"
                  >
                    回填
                  </button>
                )}
              </div>
              <div className="mt-0.5 line-clamp-3 text-[10px] break-words text-muted-foreground">
                {r.error ? `失败：${r.error}` : r.output}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteNode({ data, selected }: NodeProps<Node<BoardNodeData>>) {
  const { entry, onRemove, onEditNote, onApplyRun, onResize } = data
  const { node } = entry
  const sized = !!(node.width && node.height)
  const [showHistory, setShowHistory] = useState(false)
  const runs = node.runs ?? []

  return (
    <div
      style={sized ? { width: "100%", height: "100%" } : undefined}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-amber-50 text-amber-950 shadow-sm dark:bg-amber-950/30 dark:text-amber-100",
        !sized && "w-[220px]",
        selected
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-amber-300/70 dark:border-amber-800"
      )}
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

      <div className="flex items-center gap-1.5 border-b border-amber-300/60 px-2.5 py-1.5 dark:border-amber-800/60">
        <FileText className="size-3 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {node.title || "便签"}
        </span>
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

      <textarea
        defaultValue={node.note ?? ""}
        onChange={(e) => onEditNote(node.id, e.target.value)}
        rows={4}
        placeholder="写点什么…"
        className={cn(
          "nodrag resize-none bg-transparent px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:opacity-50",
          sized ? "min-h-0 flex-1" : ""
        )}
      />

      {showHistory && runs.length > 0 && (
        <div className="max-h-[200px] shrink-0 overflow-y-auto border-t border-amber-300/60 bg-amber-100/40 p-1.5 dark:border-amber-800/60 dark:bg-amber-950/40">
          {runs.map((r) => (
            <div key={r.id} className="mb-1 text-[10px]">
              <div className="flex items-center gap-1 opacity-70">
                <span>{new Date(r.createdAt).toLocaleTimeString()}</span>
                <span className="min-w-0 flex-1 truncate">{r.prompt || "无提示词"}</span>
                {!r.error && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-primary hover:underline"
                    onClick={() => onApplyRun(node.id, r.id)}
                  >
                    回填
                  </button>
                )}
              </div>
              <div className="line-clamp-3 break-words opacity-80">
                {r.error ? `失败：${r.error}` : r.output}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
