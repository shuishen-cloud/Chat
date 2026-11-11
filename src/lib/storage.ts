import { DEFAULT_BASE_URL, DEFAULT_MODEL, type ChatState, type Conversation, type Message, type Project } from "./types"

const STORAGE_KEY = "shadcn-chat/state/v1"

const EMPTY: ChatState = {
  projects: [],
  conversations: [],
  activeProjectId: null,
  activeConversationId: null,
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
}

export function loadState(): ChatState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<ChatState>
    return {
      ...EMPTY,
      ...parsed,
      // 中断的流式消息，重新加载时清理
      conversations: (parsed.conversations ?? []).map((c: Conversation) => ({
        ...c,
        messages: (c.messages ?? []).map((m: Message) => ({
          ...m,
          streaming: false,
        })),
      })),
      projects: parsed.projects ?? [],
    }
  } catch {
    return EMPTY
  }
}

export function saveState(state: ChatState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 配额溢出等情况静默失败，不阻塞 UI
  }
}

export function nextTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim())
  if (!first) return "新对话"
  const t = first.content.trim().replace(/\s+/g, " ")
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}

export type { ChatState, Conversation, Message, Project }
