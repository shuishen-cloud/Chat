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

export interface ChatState {
  projects: Project[]
  conversations: Conversation[]
  favorites: Favorite[]
  tags: Tag[]
  activeProjectId: string | null
  activeConversationId: string | null
  apiKey: string
  baseUrl: string
  model: string
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
