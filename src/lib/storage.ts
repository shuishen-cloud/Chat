import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  uid,
  type Board,
  type BoardEdge,
  type BoardNode,
  type BoardTask,
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
  boards: [],
  boardNodes: [],
  boardEdges: [],
  boardTasks: [],
  activeProjectId: null,
  activeConversationId: null,
  activeBoardId: null,
  activeTaskId: null,
  mainView: "chat",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  sidebarView: "list",
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

    const boards: Board[] = parsed.boards ?? []
    const { boardNodes, boardEdges, boardTasks } = gcBoardRefs(
      convs,
      boards,
      parsed.boardNodes ?? [],
      parsed.boardEdges ?? [],
      parsed.boardTasks ?? []
    )

    return {
      ...EMPTY,
      ...parsed,
      conversations: convs,
      favorites: valid,
      tags: parsed.tags ?? [],
      projects: parsed.projects ?? [],
      boards,
      boardNodes,
      boardEdges,
      boardTasks,
      activeTaskId: boardTasks.some((x) => x.id === parsed.activeTaskId)
        ? (parsed.activeTaskId ?? null)
        : null,
      // 指向已删除画板/对话的视图状态需要回退
      activeBoardId: boards.some((b) => b.id === parsed.activeBoardId)
        ? (parsed.activeBoardId ?? null)
        : null,
      mainView: parsed.mainView === "board" ? "board" : "chat",
    }
  } catch {
    return EMPTY
  }
}

/**
 * 清理画板的悬空引用：源消息 / 源对话 / 画板被删除后，相关节点、边、连线一并丢弃。
 * 删除对话、清空消息、删除项目后都会复用这个函数，避免图谱里出现无法打开的孤立卡片。
 */
export function gcBoardRefs(
  conversations: Conversation[],
  boards: Board[],
  boardNodes: BoardNode[],
  boardEdges: BoardEdge[],
  boardTasks: BoardTask[] = []
): { boardNodes: BoardNode[]; boardEdges: BoardEdge[]; boardTasks: BoardTask[] } {
  const boardIds = new Set(boards.map((b) => b.id))
  const convById = new Map(conversations.map((c) => [c.id, c]))

  const nodes = boardNodes.filter((n) => {
    if (!boardIds.has(n.boardId)) return false
    if (n.kind === "note") return true
    const conv = n.ref ? convById.get(n.ref.conversationId) : undefined
    if (!conv) return false
    return conv.messages.some((m) => m.id === n.ref!.messageId)
  })

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = boardEdges.filter(
    (e) => boardIds.has(e.boardId) && nodeIds.has(e.from) && nodeIds.has(e.to)
  )

  // 任务里引用的边若已消失，同步剔除，避免运行时指向空
  const edgeIds = new Set(edges.map((e) => e.id))
  const tasks = boardTasks
    .filter((task) => boardIds.has(task.boardId))
    .map((task) => {
      const kept = task.edgeIds.filter((id) => edgeIds.has(id))
      return kept.length === task.edgeIds.length
        ? task
        : { ...task, edgeIds: kept }
    })

  return { boardNodes: nodes, boardEdges: edges, boardTasks: tasks }
}

/** 对完整 state 做一次画板 gc，供各删除类动作复用 */
export function withBoardGc(state: ChatState): ChatState {
  const { boardNodes, boardEdges, boardTasks } = gcBoardRefs(
    state.conversations,
    state.boards,
    state.boardNodes,
    state.boardEdges,
    state.boardTasks
  )
  if (
    boardNodes.length === state.boardNodes.length &&
    boardEdges.length === state.boardEdges.length &&
    boardTasks.every(
      (t, i) => t.edgeIds.length === state.boardTasks[i]?.edgeIds.length
    )
  ) {
    return state
  }
  return { ...state, boardNodes, boardEdges, boardTasks }
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

export type {
  Board,
  BoardEdge,
  BoardNode,
  BoardTask,
  ChatState,
  Conversation,
  Favorite,
  Message,
  Project,
}
