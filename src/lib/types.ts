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
}

export interface Conversation {
  id: string
  projectId: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  createdAt: number
}

export interface ChatState {
  projects: Project[]
  conversations: Conversation[]
  activeProjectId: string | null
  activeConversationId: string | null
  apiKey: string
  baseUrl: string
  model: string
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
