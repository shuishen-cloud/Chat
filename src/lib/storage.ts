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
  thinkingEnabled: true,
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
    return normalizeLoaded(JSON.parse(raw) as Partial<ChatState>)
  } catch {
    return EMPTY
  }
}

/**
 * 把「来路不明的 ChatState 片段」清洗成可用的完整状态。
 *
 * 同时服务于两个入口：localStorage（可能来自旧版本）与服务端
 * （可能是另一个设备写入的、字段更全或更旧的数据）。
 * 清洗是幂等的，重复调用不会改变结果。
 */
export function normalizeLoaded(parsed: Partial<ChatState>): ChatState {
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
    // 老数据没有该字段，按「开启」处理，保持既有行为
    thinkingEnabled: parsed.thinkingEnabled !== false,
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

export function saveState(state: ChatState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (err) {
    /*
     * 配额溢出等情况不能完全静默：用户会以为数据已经保存，
     * 刷新后才发现丢失。这里返回 false，由调用方提示。
     */
    console.error("[shadcn-chat] 保存失败，本地存储可能已满", err)
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 服务端同步
 *
 * 定位：服务端是唯一权威副本，localStorage 只是缓存与离线兜底。
 * 因此没有「合并」逻辑——拉到什么就是什么，拉不到就继续用本地。
 * ------------------------------------------------------------------ */

export interface RemoteState {
  /** 服务端写入时刻，写入时必须原样带回，用于并发检测 */
  updatedAt: number
  /** null 表示服务端还没有数据 */
  state: ChatState | null
}

export type PushResult =
  | { ok: true; updatedAt: number }
  | { ok: false; conflict: true; updatedAt: number }
  | null

/**
 * 当前构建是否启用了服务端同步。
 *
 * 生产构建始终启用；dev 下默认关闭，因为开发时通常没有后端，
 * 而请求会拿到 Vite 的 SPA 回落（HTML），`res.json()` 解析失败
 * 虽然会被 catch，但浏览器仍会记一条 console error——
 * 既有 Playwright 用例断言「控制台无错误」，会被这条噪声打挂。
 *
 * 本地联调多端时：`node server/index.ts` + `VITE_API_PROXY=... npm run dev`，
 * 此时 vite 会把 /api 代理到真后端，开关随之打开（由 vite.config.ts 的
 * define 注入 `__REMOTE_SYNC__`）。
 */
const REMOTE_SYNC_ENABLED = __REMOTE_SYNC__ === "1"

/** 拉取服务端状态。网络或服务端异常一律返回 null，由调用方降级 */
export async function fetchRemoteState(): Promise<RemoteState | null> {
  if (!REMOTE_SYNC_ENABLED) return null
  try {
    const res = await fetch("/api/state", { headers: { accept: "application/json" } })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<RemoteState>
    if (typeof data.updatedAt !== "number") return null
    return {
      updatedAt: data.updatedAt,
      state: (data.state as ChatState | null) ?? null,
    }
  } catch {
    return null
  }
}

/**
 * 推送整包状态。
 *
 * `base` 必须是上次成功同步拿到的 `updatedAt`：服务端据此判断
 * 客户端是否基于最新副本，不匹配则返回 conflict，避免旧快照
 * 覆盖掉其他设备刚写入的消息。
 */
export async function pushRemoteState(
  state: ChatState,
  base: number
): Promise<PushResult> {
  if (!REMOTE_SYNC_ENABLED) return null
  try {
    const res = await fetch(`/api/state?base=${base}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    })
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { updatedAt?: number }
      return {
        ok: false,
        conflict: true,
        updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : base,
      }
    }
    if (!res.ok) return null
    const data = (await res.json()) as { updatedAt?: number }
    if (typeof data.updatedAt !== "number") return null
    return { ok: true, updatedAt: data.updatedAt }
  } catch {
    return null
  }
}

/**
 * 是否该把当前状态推给服务端。
 *
 * 流式生成中不推：一方面会以 token 频率打满请求，
 * 另一方面别的设备刷新后会看到半截回复。生成结束再统一推一次。
 */
export function hasStreamingMessage(state: ChatState): boolean {
  return state.conversations.some((c) =>
    c.messages.some((m) => m.streaming)
  )
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
