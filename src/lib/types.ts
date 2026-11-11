export type Role = "user" | "assistant"

export interface Message {
  id: string
  role: Role
  content: string
  /** 思维链（V4 Pro 等模型可能返回） */
  reasoning?: string
  /** 流式输出进行中 */
  streaming?: boolean
  /** 请求失败时的错误信息 */
  error?: string
  createdAt: number
  /** 已废弃：旧版收藏标记，启动时迁移至 Favorite 记录 */
  favorite?: boolean
  /** 已废弃：旧版收藏时间，启动时迁移 */
  favoritedAt?: number
}

/** 收藏项：独立实体，携带自己的元数据 */
export interface Favorite {
  id: string
  conversationId: string
  messageId: string
  /** 标签 id 列表 */
  tagIds: string[]
  /** 用户备注 */
  note?: string
  createdAt: number
}

/** 标签 */
export interface Tag {
  id: string
  name: string
  /** 色相值 0-360，用于生成柔和的标记色 */
  hue: number
}

export interface Conversation {
  id: string
  projectId: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  /** 分支来源：从哪个对话的哪条消息处分叉而来 */
  branchedFrom?: {
    conversationId: string
    conversationTitle: string
    messageId: string
  }
  /** 颜色标记（色相值），用于侧边栏快速区分 */
  hue?: number
  /** 置顶到列表顶部 */
  pinned?: boolean
  /** 已归档（从主列表折叠隐藏） */
  archived?: boolean
}

export interface Project {
  id: string
  name: string
  createdAt: number
}

/** 侧边栏视图模式 */
export type SidebarView = "list" | "tree"

/** 主区域视图：对话 / 画板 */
export type MainView = "chat" | "board"

/**
 * 画板节点只保存「引用 + 用户加工层」，不复制消息正文。
 * 这样源消息变化不会产生副本不一致，删除源消息时只需 gc 悬空引用。
 */
export type BoardNodeKind = "message" | "note"

export interface BoardNode {
  id: string
  boardId: string
  kind: BoardNodeKind
  /** kind=message 时的引用源 */
  ref?: { conversationId: string; messageId: string }
  /** 用户改写的标题，空则取源消息首行 */
  title?: string
  /** 用户备注 / 批注 */
  note?: string
  /** 仅摘录部分文字时保存的片段，空则整段引用 */
  excerpt?: string
  /** 画布坐标（左上角） */
  x: number
  y: number
  /** 用户拖拽过的卡片尺寸；空则用默认尺寸自适应内容 */
  width?: number
  height?: number
  /** 展开显示完整正文 */
  expanded?: boolean
  /**
   * 用户直接改写的内容。存在时优先于源消息 / excerpt 显示。
   * 引用型节点一旦填写此字段，就与源消息脱钩（UI 上标记「已改写」）。
   */
  contentOverride?: string
  /** 运行历史，最新的在前 */
  runs?: NodeRun[]
  /** 颜色标记（色相值） */
  hue?: number
  createdAt: number
}

/** 一次连线执行留下的快照记录 */
export interface NodeRun {
  id: string
  /** 由哪条边触发 */
  edgeId: string
  /** 运行时的提示词快照（边后来改了也保留当时的值） */
  prompt: string
  /** 输入材料快照 */
  inputs: { nodeId: string; title: string; text: string }[]
  output: string
  error?: string
  createdAt: number
}

export type BoardEdgeKind = "manual" | "reference" | "branch" | "flow"

export interface BoardEdge {
  id: string
  boardId: string
  from: string
  to: string
  kind: BoardEdgeKind
  label?: string
  /** 该连线携带的提示词；kind=flow 时参与执行 */
  prompt?: string
  /** 是否参与任务执行，undefined 视为 true */
  enabled?: boolean
  /** 四向连接点标识，避免节点换边后连线错位 */
  sourceHandle?: string
  targetHandle?: string
  /** 线的颜色标记（色相值） */
  hue?: number
  /**
   * 提示词徽章的独立颜色。
   * 与线的颜色分开：线本身可以中性，只让提示词显眼，反之亦然。
   */
  promptHue?: number
}

/**
 * 任务：用户显式挑选的一组边，构成一次可反复执行的上下文组织。
 * 不做拓扑排序，不自动串联，每条边都是独立执行单元。
 */
export interface BoardTask {
  id: string
  boardId: string
  name: string
  /** 加入任务的边 id 列表 */
  edgeIds: string[]
  createdAt: number
  updatedAt: number
}

export interface Board {
  id: string
  /** 归属项目；null 表示跨项目共享 */
  projectId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

export interface ChatState {
  projects: Project[]
  conversations: Conversation[]
  favorites: Favorite[]
  tags: Tag[]
  boards: Board[]
  boardNodes: BoardNode[]
  boardEdges: BoardEdge[]
  boardTasks: BoardTask[]
  activeProjectId: string | null
  activeConversationId: string | null
  activeBoardId: string | null
  activeTaskId: string | null
  mainView: MainView
  apiKey: string
  baseUrl: string
  model: string
  /** 是否展示/启用模型思考（思维链） */
  thinkingEnabled: boolean
  sidebarView: SidebarView
}

export const DEFAULT_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_MODEL = "deepseek-v4-pro"

export const MODELS = [
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "deepseek-v4-flash", label: "DeepSeek V4.1 Flash（更快）" },
  { value: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision（实验）" },
] as const

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function createProject(name: string): Project {
  return { id: uid("proj"), name, createdAt: Date.now() }
}

export function createFavorite(conversationId: string, messageId: string): Favorite {
  return {
    id: uid("fav"),
    conversationId,
    messageId,
    tagIds: [],
    createdAt: Date.now(),
  }
}

/** 预置标签色相，新标签依次取用 */
export const TAG_HUES = [45, 200, 280, 150, 20, 320, 240, 100] as const

export function createConversation(projectId: string): Conversation {
  const now = Date.now()
  return {
    id: uid("conv"),
    projectId,
    title: "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function newMessage(role: Role, content: string): Message {
  return { id: uid("msg"), role, content, createdAt: Date.now() }
}

/* ---------------- 画板 ---------------- */

/** 新节点默认尺寸与间距，用于自动排布 */
export const BOARD_NODE_W = 260
export const BOARD_NODE_H = 180
export const BOARD_GAP_X = 60
export const BOARD_GAP_Y = 40

/** 每行最多摆放的节点数，超出换行 */
export const BOARD_COLUMNS = 3

export function createBoard(projectId: string | null, name = "新画板"): Board {
  const now = Date.now()
  return { id: uid("board"), projectId, name, createdAt: now, updatedAt: now }
}

/**
 * 从消息创建引用型节点。
 * 位置由调用方给出：在同一画板里连续添加时按行列网格自动排布，避免叠在一起。
 */
export function createBoardNode(
  boardId: string,
  ref: { conversationId: string; messageId: string },
  index: number,
  excerpt?: string
): BoardNode {
  const col = index % BOARD_COLUMNS
  const row = Math.floor(index / BOARD_COLUMNS)
  return {
    id: uid("node"),
    boardId,
    kind: "message",
    ref,
    excerpt,
    x: col * (BOARD_NODE_W + BOARD_GAP_X),
    y: row * (BOARD_NODE_H + BOARD_GAP_Y),
    createdAt: Date.now(),
  }
}

export function createNoteNode(boardId: string, text: string, x = 0, y = 0): BoardNode {
  return {
    id: uid("node"),
    boardId,
    kind: "note",
    // 不预设标题，渲染层回退到「便签」，避免标题与占位文字重复
    note: text,
    x,
    y,
    createdAt: Date.now(),
  }
}

export function createBoardEdge(
  boardId: string,
  from: string,
  to: string,
  kind: BoardEdgeKind = "manual",
  handles?: { sourceHandle?: string; targetHandle?: string }
): BoardEdge {
  return {
    id: uid("edge"),
    boardId,
    from,
    to,
    kind,
    ...(handles?.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
    ...(handles?.targetHandle ? { targetHandle: handles.targetHandle } : {}),
  }
}

export function createBoardTask(boardId: string, name: string): BoardTask {
  const now = Date.now()
  return {
    id: uid("task"),
    boardId,
    name: name.trim() || "新任务",
    edgeIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 该边是否参与执行：只有 flow 且未显式禁用 */
export function isRunnableEdge(edge: BoardEdge): boolean {
  return edge.kind === "flow" && edge.enabled !== false
}
