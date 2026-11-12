/**
 * 交互状态机：画布上同一时刻只可能有一类交互在进行。
 *
 * 这是为了解决 v1 的「抢交互」问题（拉线抢拖拽、缩放手柄抢节点拖动）：
 * 不再靠 CSS 层级和 opacity 去错开，而是**只在该状态下才挂对应事件**。
 *
 * 纯函数，无 React、无 DOM。
 */

export type InteractionKind =
  | "idle"
  | "dragging"
  | "resizing"
  | "connecting"
  | "marquee"
  | "edge-menu"

export type Interaction =
  | { type: "idle" }
  | { type: "dragging"; nodeIds: string[] }
  | { type: "resizing"; nodeId: string; dir: string }
  | { type: "connecting"; nodeId: string; handle: string }
  | { type: "marquee" }
  | { type: "edge-menu"; edgeId: string }

export type InteractionEvent =
  | { type: "node:pointerdown"; nodeId: string; selectedIds: string[] }
  | { type: "resizer:pointerdown"; nodeId: string; dir: string }
  | { type: "handle:pointerdown"; nodeId: string; handle: string }
  | { type: "canvas:pointerdown" }
  | { type: "edge:click"; edgeId: string }
  | { type: "pointerup"; overTarget?: boolean }
  | { type: "escape" }

/** 每种状态是否允许某类交互启动 */
const STARTABLE: Record<InteractionKind, InteractionKind[]> = {
  // 空闲时任何交互都能启动
  idle: ["dragging", "resizing", "connecting", "marquee", "edge-menu"],
  // 进行中只允许自己被再次触发（幂等），不允许别的交互插进来
  dragging: ["dragging"],
  resizing: ["resizing"],
  connecting: ["connecting"],
  marquee: ["marquee"],
  // 边编辑器打开时，画布交互一律不接管（避免点菜单外区域变成框选）
  "edge-menu": ["edge-menu"],
}

export function kindOf(state: Interaction): InteractionKind {
  return state.type
}

/** 某状态下能否启动某类交互 */
export function canStart(state: Interaction, want: InteractionKind): boolean {
  return STARTABLE[state.type].includes(want)
}

/** 是否为「进行中」的指针交互（用于加 cursor / 禁用某些 UI） */
export function isActive(state: Interaction): boolean {
  return state.type === "dragging" || state.type === "resizing" || state.type === "connecting"
}

export type ReduceResult = {
  state: Interaction
  /** 非法转移的原因；由调用方记 warning（设计文档要求） */
  rejected?: string
}

/**
 * 状态转移。
 *
 * 约定：**非法转移不抛异常**，保持原状态并返回 rejected 原因。
 * 这样 UI 不会因为某个组件绕过状态机而白屏，同时日志能暴露问题。
 */
export function reduceInteraction(state: Interaction, ev: InteractionEvent): ReduceResult {
  switch (ev.type) {
    case "escape":
      return { state: { type: "idle" } }

    case "pointerup":
      return { state: { type: "idle" } }

    case "node:pointerdown":
      if (!canStart(state, "dragging")) {
        return { state, rejected: `在 ${state.type} 中启动拖拽` }
      }
      return { state: { type: "dragging", nodeIds: dragTargets(ev.nodeId, ev.selectedIds) } }

    case "resizer:pointerdown":
      if (!canStart(state, "resizing")) {
        return { state, rejected: `在 ${state.type} 中启动缩放` }
      }
      return { state: { type: "resizing", nodeId: ev.nodeId, dir: ev.dir } }

    case "handle:pointerdown":
      if (!canStart(state, "connecting")) {
        return { state, rejected: `在 ${state.type} 中启动连线` }
      }
      return { state: { type: "connecting", nodeId: ev.nodeId, handle: ev.handle } }

    case "canvas:pointerdown":
      if (!canStart(state, "marquee")) {
        return { state, rejected: `在 ${state.type} 中启动框选` }
      }
      return { state: { type: "marquee" } }

    case "edge:click":
      if (!canStart(state, "edge-menu")) {
        return { state, rejected: `在 ${state.type} 中打开边菜单` }
      }
      return { state: { type: "edge-menu", edgeId: ev.edgeId } }
  }
}

/**
 * 拖拽涉及哪些节点：
 * 多选时拖其中一个 = 整组一起移动；否则只拖它自己。
 */
export function dragTargets(nodeId: string, selectedIds: string[]): string[] {
  return selectedIds.includes(nodeId) && selectedIds.length > 1 ? [...selectedIds] : [nodeId]
}
