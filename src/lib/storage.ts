import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  uid,
  type ChatState,
  type Conversation,
  type Favorite,
  type Message,
  type Project,
} from "./types"

const STORAGE_KEY = "shadcn-chat/state/v1"

const EMPTY: ChatState = {
  projects: [],
  conversations: [],
  favorites: [],
  tags: [],
  activeProjectId: null,
  activeConversationId: null,
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
}

/**
 * 旧版把收藏挂在 Message.favorite 上，新版改为独立 Favorite 实体。
 * 启动时做一次幂等迁移：凡是被引用的消息，其 legacy 标记会被清掉。
 */
function migrateLegacyFavorites(
  conversations: Conversation[],
  favorites: Favorite[]
): { conversations: Conversation[]; favorites: Favorite[] } {
  const migrated: Favorite[] = [...favorites]
  const seen = new Set(
    favorites.map((f) => `${f.conversationId}:${f.messageId}`)
  )

  const nextConversations = conversations.map((c) => {
    let changed = false
    const messages = c.messages.map((m) => {
      if (!m.favorite) return m
      changed = true
      const key = `${c.id}:${m.id}`
      if (!seen.has(key)) {
        seen.add(key)
        migrated.push({
          id: uid("fav"),
          conversationId: c.id,
          messageId: m.id,
          tagIds: [],
          createdAt: m.favoritedAt ?? Date.now(),
        })
      }
      // 清掉旧字段，避免重复迁移
      const { favorite: _f, favoritedAt: _fa, ...rest } = m
      return rest
    })
    return changed ? { ...c, messages } : c
  })

  return { conversations: nextConversations, favorites: migrated }
}

export function loadState(): ChatState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<ChatState>

    const conversations = (parsed.conversations ?? []).map((c: Conversation) => ({
      ...c,
      messages: (c.messages ?? []).map((m: Message) => ({
        ...m,
        streaming: false,
      })),
    }))

    const { conversations: convs, favorites } = migrateLegacyFavorites(
      conversations,
      parsed.favorites ?? []
    )

    // 丢弃指向已不存在消息的收藏
    const valid = favorites.filter((f) => {
      const conv = convs.find((c) => c.id === f.conversationId)
      return !!conv?.messages.some((m) => m.id === f.messageId)
    })

    return {
      ...EMPTY,
      ...parsed,
      conversations: convs,
      favorites: valid,
      tags: parsed.tags ?? [],
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

export type { ChatState, Conversation, Favorite, Message, Project }
