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
  BaseEdge,
  EdgeLabelRenderer,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  getBezierPath,
  type Connection,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { LongPressTracker } from "./long-press"
import { useRefreshNodeInternals } from "./use-refresh-node-internals"

import { DEFAULT_WIDTH, type BoardCard, type BoardDoc } from "../model/doc"
import { registerViewportCenter } from "../model/layout"
import {
  EDGE_TYPE,
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
  /** 正在编辑的边（悬浮编辑器打开中），用于把线高亮成「可编辑」 */
  editingEdgeId?: string | null
  /** 源消息等外部上下文（按卡片查） */
  sourceOf: (card: BoardCard) => CardData["source"]
  dark: boolean
  actions: CardActions
  /** 文档几何变更（位置/尺寸/删边）统一从这里出去 */
  onDocChange: (next: BoardDoc) => void
  /**
   * 长按线：打开编辑器。
   *
   * `anchor` 是**屏幕上真实按下点**，不再是边的包围盒中心：
   * 悬浮窗要贴在手指/鼠标所在处，而不是钉在屏幕中部。
   */
  onEdgeClick: (edgeId: string, anchor: { x: number; y: number }) => void
  /**
   * 短按线：执行这条线。
   *
   * 语义分工（用户的心智模型）：**点击 = 干活，长按 = 改这条线**。
   * 不可执行的线（纯联系/被禁用）点击不做事，只提示。
   */
  onEdgeRun?: (edgeId: string) => void
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
  editingEdgeId = null,
  sourceOf,
  dark,
  actions,
  onDocChange,
  onEdgeClick,
  onEdgeRun,
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

  /** 当前进行中的长按计时器（同一时刻只允许一个） */
  const trackerRef = useRef<LongPressTracker | null>(null)
  /**
   * 上一次手势被命中块处理过的时间戳。
   *
   * 命中块的 pointerup 与 React Flow 的 onEdgeClick 是**同一手势的两条路径**：
   * 前者立刻拿到执行/编辑，后者随后还会再派发一次。没有这道去重，
   * 点击一次线会发两次请求（实测两个 NodeRun）。
   */
  const lastHandledAtRef = useRef(0)

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

  /** 画布容器：换算视口中心需要它的尺寸与屏幕位置 */
  const wrapRef = useRef<HTMLDivElement | null>(null)

  /* ---------- React Flow store（唯一真值） ---------- */

  /** 单条边的显示状态 */
  const edgeVisual = useCallback(
    (id: string) => ({
      selected: selectedEdgeIds.includes(id),
      executing: executingEdgeId === id,
      pickMode: edgePickMode,
      editing: editingEdgeId === id,
    }),
    [selectedEdgeIds, executingEdgeId, edgePickMode, editingEdgeId]
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
    setEdges(doc.edges.map((e) => decorateEdge(toFlowEdge(e), edgeVisual(e.id), e, dark)))
    // dark 进依赖：线的颜色在暗色下要换一套值（颜色是内联变量，不是 CSS class）
  }, [doc, edgeVisual, setEdges, dark])

  /* ---------- 首次挂载：视口对准指定位置 ---------- */

  /**
   * 注册「视口中心 → 流坐标」换算器。
   *
   * store 的新建动作（新建便签、加入卡片）用它决定落点：
   * 让新内容出现在用户此刻正看着的画布中央。
   *
   * 用 getViewport 而非屏幕坐标：平移/缩放后视口会变，
   * 换算必须每次现算，不能缓存。
   */
  const { getViewport } = useReactFlow()

  /**
   * 手柄位置刷新。
   *
   * 踩过的坑：React Flow 只在节点**首次量测**时记录 handleBounds，
   * 而我们的卡片高度由内容决定（首帧内容还没排完，高度为 0），
   * 于是手柄被记到 `y = -10`，连线从节点上方 10px 处画出来——
   * 表现为「线飘在卡片外面」。节点内容/尺寸变化后必须主动刷新，
   * 否则边的端点永远是首帧那个错误值。
   */
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    return registerViewportCenter(() => {
      const box = wrapRef.current?.getBoundingClientRect()
      if (!box) return null
      const vp = getViewport()
      /*
       * 屏幕坐标 = 容器左上 + 视口偏移 + 流坐标 × zoom
       * 反解出「容器中心对应的流坐标」。
       */
      return {
        x: (box.width / 2 - vp.x) / vp.zoom,
        y: (box.height / 2 - vp.y) / vp.zoom,
      }
    })
  }, [getViewport])

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

  /* ---------- 边的长按编辑 ---------- */

  /**
   * 线的两种手势，语义严格分开：
   *
   *  - **长按** → 打开编辑器（锚点 = 屏幕上真实按下点，悬浮窗贴着手指/鼠标）；
   *  - **短按** → 执行这条线（不可执行时什么都不做，由上层给提示）。
   *
   * 选边模式下两者都退化为「加入/移出任务」——那时用户在挑边，不是在操作边。
   */
  const openEdgeEditor = useCallback(
    (edgeId: string, anchor: { x: number; y: number }) => {
      if (edgePickMode) {
        onEdgePick?.(edgeId)
        return
      }
      send({ type: "edge:click", edgeId })
      onEdgeClick(edgeId, anchor)
    },
    [edgePickMode, onEdgePick, send, onEdgeClick]
  )

  const runEdge = useCallback(
    (edgeId: string) => {
      if (edgePickMode) {
        onEdgePick?.(edgeId)
        return
      }
      onEdgeRun?.(edgeId)
    },
    [edgePickMode, onEdgePick, onEdgeRun]
  )

  /** 浮层要用的实时值：避免把回调塞进 edgeTypes 造成整图重挂 */
  const editRef = useRef({ openEdgeEditor, runEdge })
  editRef.current = { openEdgeEditor, runEdge }

  /**
   * 自定义边：默认贝塞尔曲线 + 一个「标签渲染层」命中块。
   *
   * 为什么需要命中块：边路径只有 1.8px 宽，在触屏和密集连线里几乎点不中。
   * 在线的中点放一个 44×22 的透明块，长按/点击都能稳定命中；
   * 它同时承担「线条文字」的展示，文字本身也进命中区。
   */
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      board: (props: EdgeProps<RtEdge>) => {
        const {
          id,
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          label,
          markerEnd,
          style,
        } = props
        const [path, labelX, labelY] = getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        })

        /* 同一套手势逻辑挂在两处：整条线的宽交互带（主）+ 中点徽章（文字上也能按） */
        const gesture = {
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          onPointerDown: (e: React.PointerEvent) => {
            // 只响应主键/触摸，避免右键菜单被当成编辑手势
            if (e.button !== 0) return
            e.stopPropagation()
            const anchor = { x: e.clientX, y: e.clientY }
            const tracker = new LongPressTracker({
              onLongPress: () => {
                // 长按 = 改这条线
                lastHandledAtRef.current = Date.now()
                editRef.current.openEdgeEditor(id, anchor)
              },
              // 短按 = 跑这条线（编辑要长按，避免手抖误开编辑窗）
              onPress: () => {
                lastHandledAtRef.current = Date.now()
                editRef.current.runEdge(id)
              },
            })
            trackerRef.current?.dispose()
            trackerRef.current = tracker
            tracker.down(anchor)
          },
          onPointerMove: (e: React.PointerEvent) =>
            trackerRef.current?.move({ x: e.clientX, y: e.clientY }),
          onPointerUp: (e: React.PointerEvent) => {
            trackerRef.current?.up({ x: e.clientX, y: e.clientY })
            trackerRef.current?.dispose()
            trackerRef.current = null
          },
          onPointerCancel: () => {
            trackerRef.current?.dispose()
            trackerRef.current = null
          },
        }

        return (
          <>
            <BaseEdge
              id={id}
              path={path}
              style={style}
              markerEnd={markerEnd}
              /* 关掉框架自带的交互带，下面用更宽的、带手势的版本取代 */
              interactionWidth={0}
            />
            {/*
             * 整条线的长按/点击热区。
             *
             * 之前只在线的中点放了一个 40×20 的小块，用户按在线上其它位置
             * 完全没有反应——「长按线条没反应」就是这么来的。
             * 这里沿整条贝塞尔路径铺一条 26px 宽的透明描边，
             * 线有多长，可长按的范围就有多长。
             */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={26}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              className="board-edge-hit-area nodrag nopan"
              data-edge-id={id}
              {...gesture}
            />
            <EdgeLabelRenderer>
              <div
                className="board-edge-hit nodrag nopan"
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                  pointerEvents: label ? "all" : "none",
                }}
                data-edge-id={id}
                title="点击执行 · 长按编辑"
                {...gesture}
              >
                {label ? (
                  <span className="board-edge-chip" style={{ color: "var(--board-edge-chip-fg, inherit)" }}>
                    {label}
                  </span>
                ) : null}
              </div>
            </EdgeLabelRenderer>
          </>
        )
      },
    }),
    []
  )

  /* ---------- 卡片渲染 ---------- */

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      [FLOW_NODE_TYPE]: ({ id, data, selected }: { id: string; data: CardData; selected?: boolean }) => {
        const node = docRef.current.nodes.find((n) => n.id === id)
        // 内容或尺寸变化后手柄位置会过期，这里统一刷新（见 updateNodeInternals 的注释）
        useRefreshNodeInternals(id, node, updateNodeInternals)
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
    // updateNodeInternals 是框架稳定引用，但漏写会让 lint 与「刷新失效」同时报错
    [dark, commitGeometry, updateNodeInternals]
  )

  return (
    <div
      ref={wrapRef}
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
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: EDGE_TYPE }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handlePointerUp}
        onConnectStart={handleConnectStart}
        onConnectEnd={handlePointerUp}
        onConnect={handleConnect}
        onPaneClick={() => send({ type: "pointerup" })}
        /*
         * 兜底路径：命中块没接住时（键盘聚焦、无障碍、命中块被隐藏）。
         * 语义必须与命中块一致：点击 = 执行，不是编辑。
         */
        onEdgeClick={(_, edge) => {
          // 同一手势已经被命中块处理过（≤400ms），不再重复执行
          if (Date.now() - lastHandledAtRef.current < 400) return
          runEdge(edge.id)
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
