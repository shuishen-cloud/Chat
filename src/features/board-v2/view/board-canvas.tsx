/**
 * 画布：React Flow 挂载与事件接线。
 *
 * 设计约束（doc/feat/board-v2-rewrite.md §一）：
 *  - **唯一真值 = React Flow store**（useNodesState / useEdgesState）；
 *  - 不维护第二份坐标/尺寸副本，不用 useEffect 把数据写回 store；
 *  - 不过滤 NodeChange：position/dimensions/select 一律交给 applyNodeChanges。
 *
 * 本文件只做「事件 → 领域文档」的翻译，不写业务规则。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { DEFAULT_WIDTH, type BoardCard, type BoardDoc } from "../model/doc"
import {
  FLOW_NODE_TYPE,
  decorateEdge,
  fromFlow,
  toFlowEdge,
  toFlowNode,
  type CardData,
  type RtEdge,
  type RtNode,
} from "../model/map"
import { reduceInteraction, type Interaction, type InteractionEvent } from "../interaction/machine"
import { MessageCard } from "./cards/message-card"
import { NoteCard } from "./cards/note-card"

/** 卡片动作：全部按 id 调用，卡片本身不认识 store */
export type CardActions = {
  onRemove: (id: string) => void
  onToggleExpand: (id: string) => void
  onSaveContent: (id: string, text: string) => void
  onRestore: (id: string) => void
  onApplyRun: (id: string, runId: string) => void
  onSetHue: (id: string, hue: number | undefined) => void
  onJump?: (id: string) => void
}

export type BoardCanvasProps = {
  doc: BoardDoc
  /** 任务选中的边 id（UI 状态，不进 doc） */
  selectedEdgeIds?: string[]
  /** 正在执行的边 id */
  executingEdgeId?: string | null
  /** 选边模式：点线加入/移出任务 */
  edgePickMode?: boolean
  onEdgePick?: (edgeId: string) => void
  /** 源消息等外部上下文（按卡片查） */
  sourceOf: (card: BoardCard) => CardData["source"]
  dark: boolean
  actions: CardActions
  /** 文档几何变更（位置/尺寸/删边）统一从这里出去 */
  onDocChange: (next: BoardDoc) => void
  onEdgeClick: (edgeId: string, anchor: { x: number; y: number }) => void
  onConnect: (from: { nodeId: string; handle: string }, to: { nodeId: string; handle: string }) => void
  onInteractionChange?: (state: Interaction) => void
}

export function BoardCanvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  )
}

function InnerCanvas({
  doc,
  selectedEdgeIds = [],
  executingEdgeId = null,
  edgePickMode = false,
  onEdgePick,
  sourceOf,
  dark,
  actions,
  onDocChange,
  onEdgeClick,
  onConnect,
  onInteractionChange,
}: BoardCanvasProps) {
  /* ---------- 实时引用（回调要读最新值，又不该因此重建） ---------- */

  const docRef = useRef(doc)
  docRef.current = doc
  const sourceRef = useRef(sourceOf)
  sourceRef.current = sourceOf
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  /* ---------- 交互状态机 ---------- */

  const interactionRef = useRef<Interaction>({ type: "idle" })
  const [interaction, setInteraction] = useState<Interaction>({ type: "idle" })

  const send = useCallback(
    (ev: InteractionEvent) => {
      const { state, rejected } = reduceInteraction(interactionRef.current, ev)
      if (rejected) {
        // 设计文档要求：非法转移记 warning，暴露绕过状态机的组件
        console.warn("[board-v2] 非法交互转移：", rejected)
        return
      }
      interactionRef.current = state
      setInteraction(state)
      onInteractionChange?.(state)
    },
    [onInteractionChange]
  )

  /* ---------- React Flow store（唯一真值） ---------- */

  /** 单条边的显示状态 */
  const edgeVisual = useCallback(
    (id: string) => ({
      selected: selectedEdgeIds.includes(id),
      executing: executingEdgeId === id,
      pickMode: edgePickMode,
    }),
    [selectedEdgeIds, executingEdgeId, edgePickMode]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<RtNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<RtEdge>([])

  /**
   * store 的最新节点数组。
   *
   * 只读镜像，供事件回调（拖拽结束、提交几何）在**不触发重渲染**的前提下
   * 读到当前值。它由 useEffect 写入，不参与渲染逻辑，
   * 因此不构成「第二份真值」——真值永远是 store，这里只是它的快照引用。
   */
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  /**
   * 外部文档 → store（节点）。
   *
   * 只做投影。选中态是纯 UI 状态，不存 doc，所以这里保留当前选中集合。
   * 不在依赖里放 nodes：否则每次拖动都会把 store 覆盖回 doc 的旧坐标。
   */
  useEffect(() => {
    const selected = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
    const next = doc.nodes.map((n) => toFlowNode(n, { source: sourceRef.current(n.card), dark }))
    setNodes(next.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dark, setNodes])

  /**
   * 外部文档 → store（边）。
   *
   * 与节点分开：边的视觉状态（任务选中、执行中、选边模式）变化频繁，
   * 且不影响节点几何，合并到一个 effect 里会连带重建节点。
   */
  useEffect(() => {
    setEdges(doc.edges.map((e) => decorateEdge(toFlowEdge(e), edgeVisual(e.id), e)))
  }, [doc, edgeVisual, setEdges])

  /* ---------- 变更 → 领域文档 ---------- */

  /**
   * 把当前 store 的几何投影回领域文档。
   *
   * 复用 `fromFlow`：它按 explicitSize 判定哪些尺寸该落盘，
   * 「框架量测值」不会污染文档——这正是 v1 尺寸语义混乱的根源。
   */
  const commitGeometry = useCallback(() => {
    const projected = fromFlow(nodesRef.current, edges, docRef.current)
    const old = docRef.current
    const same =
      projected.nodes.length === old.nodes.length &&
      projected.nodes.every((n, i) => {
        const prev = old.nodes[i]
        return (
          prev &&
          prev.id === n.id &&
          prev.position.x === n.position.x &&
          prev.position.y === n.position.y &&
          prev.width === n.width &&
          prev.height === n.height
        )
      })
    if (!same) onDocChange(projected)
  }, [edges, onDocChange])

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes)
      /*
       * 只在「拖拽结束」与「尺寸变化」两种情况下落库。
       *
       * position 变更在拖动过程中会持续到来（dragging: true），
       * 此时写库既浪费又会引起上层重渲染抖动；dragging === false 才是松手。
       * 尺寸变更（缩放）没有 dragging 字段，遇到即落库——
       * 这正是 v1 缺失的一半：尺寸变化必须同步，否则被旧值覆盖。
       */
      const shouldCommit = changes.some(
        (c) =>
          (c.type === "position" && c.dragging === false) ||
          (c.type === "dimensions" && c.resizing === false)
      )
      if (shouldCommit) commitGeometry()
    },
    [onNodesChange, commitGeometry]
  )

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes)
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id))
      if (removed.size === 0) return
      onDocChange({ ...docRef.current, edges: docRef.current.edges.filter((e) => !removed.has(e.id)) })
    },
    [onEdgesChange, onDocChange]
  )

  /* ---------- 手势 ---------- */

  const handleNodeDragStart = useCallback(
    (_: unknown, node: RtNode) => {
      const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)
      send({ type: "node:pointerdown", nodeId: node.id, selectedIds })
    },
    [nodes, send]
  )

  const handleConnectStart = useCallback(
    (_: unknown, params: { nodeId: string | null; handleId: string | null }) => {
      if (!params.nodeId) return
      send({ type: "handle:pointerdown", nodeId: params.nodeId, handle: params.handleId ?? "" })
    },
    [send]
  )

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      onConnect(
        { nodeId: c.source, handle: c.sourceHandle ?? "" },
        { nodeId: c.target, handle: c.targetHandle ?? "" }
      )
    },
    [onConnect]
  )

  const handlePointerUp = useCallback(() => {
    if (interactionRef.current.type !== "idle") send({ type: "pointerup" })
  }, [send])

  /* ---------- 卡片渲染 ---------- */

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      [FLOW_NODE_TYPE]: ({ id, data, selected }: { id: string; data: CardData; selected?: boolean }) => {
        const node = docRef.current.nodes.find((n) => n.id === id)
        const sized = node?.width !== undefined && node?.height !== undefined
        const card = data.card
        const act = actionsRef.current

        const w = node?.width ?? DEFAULT_WIDTH.message
        const h = node?.height ?? 140

        if (card.kind === "note") {
          return (
            <NoteCard
              card={card}
              dark={dark}
              selected={!!selected}
              sized={sized}
              width={w}
              height={h}
              onResizeCommit={commitGeometry}
              actions={{
                onRemove: () => act.onRemove(card.id),
                onSaveContent: (t) => act.onSaveContent(card.id, t),
                onApplyRun: (r) => act.onApplyRun(card.id, r),
                onSetHue: (h) => act.onSetHue(card.id, h),
              }}
            />
          )
        }

        return (
          <MessageCard
            card={card}
            source={data.source}
            dark={dark}
            selected={!!selected}
            sized={sized}
            width={w}
            height={h}
            onResizeCommit={commitGeometry}
            actions={{
              onRemove: () => act.onRemove(card.id),
              onToggleExpand: () => act.onToggleExpand(card.id),
              onSaveContent: (t) => act.onSaveContent(card.id, t),
              onRestore: () => act.onRestore(card.id),
              onApplyRun: (r) => act.onApplyRun(card.id, r),
              onSetHue: (h) => act.onSetHue(card.id, h),
              onJump: act.onJump ? () => act.onJump!(card.id) : undefined,
            }}
          />
        )
      },
    }),
    [dark, commitGeometry]
  )

  return (
    <div
      className="relative h-full w-full"
      data-interaction={interaction.type}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => {
        if (e.key === "Escape") send({ type: "escape" })
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handlePointerUp}
        onConnectStart={handleConnectStart}
        onConnectEnd={handlePointerUp}
        onConnect={handleConnect}
        onPaneClick={() => send({ type: "pointerup" })}
        onEdgeClick={(e, edge) => {
          // 选边模式下点线 = 加入/移出任务，不打开编辑器
          if (edgePickMode) {
            onEdgePick?.(edge.id)
            return
          }
          const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
          send({ type: "edge:click", edgeId: edge.id })
          onEdgeClick(
            edge.id,
            rect
              ? { x: rect.left + rect.width / 2, y: rect.top }
              : { x: window.innerWidth / 2, y: 160 }
          )
        }}
        connectionMode={ConnectionMode.Loose}
        // 不设 fitView：viewport 归框架，节点增删绝不自动改视图
        fitView={false}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={null}
        nodeDragThreshold={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-muted" />
      </ReactFlow>
    </div>
  )
}
