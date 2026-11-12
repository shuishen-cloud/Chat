import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { streamChat } from "@/lib/deepseek"
import { loadState, nextTitle, saveState, withBoardGc } from "@/lib/storage"
import {
  LAYOUT_GAP,
  findBranchParent,
  findPreviousCard,
  placeCard,
  placeChat,
  type Slot,
} from "@/features/board-v2/model/layout"
import {
  TAG_HUES,
  createBoard,
  createBoardEdge,
  createBoardNode,
  createBoardTask,
  createConversation,
  createFavorite,
  createNoteNode,
  createProject,
  isRunnableEdge,
  newMessage,
  uid,
  type Board,
  type BoardEdge,
  type BoardNode,
  type BoardTask,
  type NodeRun,
  type ChatState,
  type Conversation,
  type Favorite,
  type Message,
  type Project,
  type Tag,
} from "@/lib/types"

/**
 * 落点计算用的卡片尺寸估算。
 *
 * 与 BOARD_NODE_W 一致，但高度不用 lib/types 里的 180——那是旧网格的行距假设，
 * 卡片自适应时的实际高度通常是 100~140，用 180 会把行距拉得很稀。
 */
const BOARD_NODE_W_DEFAULT = 260
const BOARD_NODE_H_DEFAULT = 140

/** 分支树节点：一个对话及其分支后代 */
export interface BranchNode {
  conversation: Conversation
  children: BranchNode[]
  /** 树深度，0 为根对话 */
  depth: number
}

/** 画板节点 + 解析后的源消息，供画布渲染 */
export interface BoardNodeEntry {
  node: BoardNode
  /** 引用型节点的源消息；便签节点为 undefined */
  message: Message | undefined
  conversation: Conversation | undefined
  /** 参与渲染的正文：摘录优先，否则源消息内容 */
  text: string
}

/** 收藏项 + 解析后的关联对象 */
export interface FavoriteEntry {
  favorite: Favorite
  message: Message
  conversation: Conversation
  project: Project | undefined
  tags: Tag[]
}

export function useChatStore() {
  const [state, setRawState] = useState<ChatState>(() => loadState())
  /** 供内部触发「打开设置」对话框 */
  const openSettingsRef = useRef<(() => void) | null>(null)
  /** 始终指向最新 state：异步循环里避免读到过期闭包 */
  const stateRef = useRef(state)

  /**
   * 包一层 setState，在更新发生时同步刷新 stateRef。
   *
   * 不在渲染期间写 ref（React 不允许），也不用 useEffect（会晚一帧，
   * 而 runTask 的 for 循环需要立即读到上一条线刚写入的结果）。
   */
  const setState = useCallback(
    (updater: ChatState | ((prev: ChatState) => ChatState)) => {
      setRawState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater
        stateRef.current = next
        return next
      })
    },
    []
  )
  const abortRef = useRef<AbortController | null>(null)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)

  // 持久化（防抖）。失败时提示一次，避免用户误以为已保存
  const saveFailedRef = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = saveState(state)
      if (!ok && !saveFailedRef.current) {
        saveFailedRef.current = true
        toast.error("本地存储已满，修改可能无法保留", {
          duration: 10000,
          description: "建议导出重要对话后清理旧数据",
        })
      } else if (ok) {
        saveFailedRef.current = false
      }
    }, 200)
    return () => clearTimeout(t)
  }, [state])

  // 首次进入：没有项目则建一个默认项目 + 默认会话
  useEffect(() => {
    setState((prev) => {
      if (prev.projects.length > 0) return prev
      const p = createProject("我的项目")
      const c = createConversation(p.id)
      return {
        ...prev,
        projects: [p],
        conversations: [c],
        activeProjectId: p.id,
        activeConversationId: c.id,
      }
    })
  }, [setState])

  const projects = state.projects

  const activeProject = useMemo(
    () => projects.find((p) => p.id === state.activeProjectId) ?? null,
    [projects, state.activeProjectId]
  )

  const projectConversations = useMemo(() => {
    const list = state.conversations.filter(
      (c) => c.projectId === state.activeProjectId
    )
    // 置顶优先，组内按更新时间倒序
    return list.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [state.conversations, state.activeProjectId])

  /** 未归档的会话（主列表） */
  const visibleConversations = useMemo(
    () => projectConversations.filter((c) => !c.archived),
    [projectConversations]
  )

  /** 已归档的会话 */
  const archivedConversations = useMemo(
    () => projectConversations.filter((c) => c.archived),
    [projectConversations]
  )

  /** 收藏项 + 关联的消息/对话/项目，保持扁平便于筛选 */
  const favorites = useMemo(() => {
    const out: FavoriteEntry[] = []
    for (const fav of state.favorites) {
      const conv = state.conversations.find((c) => c.id === fav.conversationId)
      if (!conv) continue
      const message = conv.messages.find((m) => m.id === fav.messageId)
      if (!message) continue
      out.push({
        favorite: fav,
        message,
        conversation: conv,
        project: state.projects.find((p) => p.id === conv.projectId),
        tags: state.tags.filter((t) => fav.tagIds.includes(t.id)),
      })
    }
    return out.sort((a, b) => b.favorite.createdAt - a.favorite.createdAt)
  }, [state.favorites, state.conversations, state.projects, state.tags])

  /**
   * 当前项目下的对话按分支关系组织成树。
   * 根节点 = 没有 branchedFrom，或父对话已不存在的对话。
   */
  const conversationTree = useMemo((): BranchNode[] => {
    const inProject = state.conversations.filter(
      (c) => c.projectId === state.activeProjectId
    )
    const byId = new Map(inProject.map((c) => [c.id, c]))
    const childrenOf = new Map<string, Conversation[]>()

    const roots: Conversation[] = []
    for (const c of inProject) {
      const parentId = c.branchedFrom?.conversationId
      // 父对话不在当前项目（被移动/删除）时，此对话升级为根
      if (parentId && byId.has(parentId) && parentId !== c.id) {
        const arr = childrenOf.get(parentId) ?? []
        arr.push(c)
        childrenOf.set(parentId, arr)
      } else {
        roots.push(c)
      }
    }

    const sortSiblings = (list: Conversation[]) =>
      [...list].sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })

    const build = (conv: Conversation, depth: number): BranchNode => ({
      conversation: conv,
      depth,
      children: sortSiblings(childrenOf.get(conv.id) ?? []).map((child) =>
        build(child, depth + 1)
      ),
    })

    return sortSiblings(roots).map((r) => build(r, 0))
  }, [state.conversations, state.activeProjectId])

  /** 某条消息是否已被收藏 */
  const favoriteOf = useCallback(
    (convId: string, messageId: string) =>
      state.favorites.find(
        (f) => f.conversationId === convId && f.messageId === messageId
      ),
    [state.favorites]
  )

  const activeConversation = useMemo(
    () =>
      state.conversations.find((c) => c.id === state.activeConversationId) ??
      null,
    [state.conversations, state.activeConversationId]
  )

  /* ---------------- 项目 ---------------- */

  const addProject = useCallback((name: string): Project => {
    const p = createProject(name.trim() || "未命名项目")
    const c = createConversation(p.id)
    setState((prev) => ({
      ...prev,
      projects: [...prev.projects, p],
      conversations: [...prev.conversations, c],
      activeProjectId: p.id,
      activeConversationId: c.id,
    }))
    return p
  }, [setState])

  const renameProject = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === id ? { ...p, name: name.trim() || p.name } : p
      ),
    }))
  }, [setState])

  const deleteProject = useCallback((id: string) => {
    setState((prev) => {
      const projects = prev.projects.filter((p) => p.id !== id)
      const conversations = prev.conversations.filter((c) => c.projectId !== id)
      const stillActive = projects.some((p) => p.id === prev.activeProjectId)
      const activeProjectId = stillActive
        ? prev.activeProjectId
        : (projects[0]?.id ?? null)
      const activeConversationId = stillActive
        ? prev.activeConversationId
        : (conversations
            .filter((c) => c.projectId === activeProjectId)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
      // 项目被删后，其对话全部消失，画板里的引用需要一并清理
      return withBoardGc({
        ...prev,
        projects,
        conversations,
        activeProjectId,
        activeConversationId,
      })
    })
  }, [setState])

  const selectProject = useCallback((id: string) => {
    setState((prev) => {
      const convs = prev.conversations
        .filter((c) => c.projectId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return {
        ...prev,
        activeProjectId: id,
        activeConversationId: convs[0]?.id ?? null,
      }
    })
  }, [setState])

  /**
   * 原子地跳转到指定对话：同时切换项目与对话。
   * 不能拆成 selectProject + selectConversation，因为前者会把
   * activeConversationId 重置为该项目最新对话，后者再改会被覆盖。
   */
  const jumpToConversation = useCallback((conversationId: string) => {
    setState((prev) => {
      const target = prev.conversations.find((c) => c.id === conversationId)
      if (!target) return prev
      return {
        ...prev,
        activeProjectId: target.projectId,
        activeConversationId: target.id,
      }
    })
  }, [setState])

  /**
   * 跳转并定位到某条消息：切项目 + 切对话 + 回对话视图，再把消息滚到可视区。
   * 画板卡片、收藏条目都复用这个动作，避免只切对话不滚动导致「看起来没反应」。
   */
  const jumpToMessage = useCallback(
    (conversationId: string, messageId?: string) => {
      setState((prev) => {
        const target = prev.conversations.find((c) => c.id === conversationId)
        if (!target) return prev
        return {
          ...prev,
          activeProjectId: target.projectId,
          activeConversationId: target.id,
          mainView: "chat",
        }
      })
      if (messageId) scrollMessageIntoView(messageId)
    },
    [setState]
  )

  /* ---------------- 会话 ---------------- */

  const addConversation = useCallback(() => {
    setState((prev) => {
      if (!prev.activeProjectId) return prev
      const c = createConversation(prev.activeProjectId)
      return {
        ...prev,
        conversations: [...prev.conversations, c],
        activeConversationId: c.id,
      }
    })
  }, [setState])

  const selectConversation = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeConversationId: id }))
  }, [setState])

  const renameConversation = useCallback((id: string, title: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, title: title.trim() || c.title } : c
      ),
    }))
  }, [setState])

  const deleteConversation = useCallback((id: string) => {
    setState((prev) => {
      const conversations = prev.conversations.filter((c) => c.id !== id)
      const activeConversationId =
        prev.activeConversationId === id
          ? (conversations
              .filter((c) => c.projectId === prev.activeProjectId)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
          : prev.activeConversationId
      return withBoardGc({ ...prev, conversations, activeConversationId })
    })
  }, [setState])

  const clearConversation = useCallback((id: string) => {
    setState((prev) =>
      withBoardGc({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === id
            ? { ...c, messages: [], title: "新对话", updatedAt: Date.now() }
            : c
        ),
      })
    )
  }, [setState])

  const moveConversation = useCallback((convId: string, projectId: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === convId ? { ...c, projectId, updatedAt: Date.now() } : c
      ),
    }))
  }, [setState])

  const togglePin = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, pinned: !c.pinned } : c
      ),
    }))
  }, [setState])

  const toggleArchive = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, archived: !c.archived } : c
      ),
    }))
  }, [setState])

  /** 将全部已归档对话恢复 */
  const unarchiveAll = useCallback((projectId: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.projectId === projectId && c.archived ? { ...c, archived: false } : c
      ),
    }))
  }, [setState])

  /** 复制会话（含全部消息，重置分支来源） */
  const duplicateConversation = useCallback((id: string) => {
    setState((prev) => {
      const src = prev.conversations.find((c) => c.id === id)
      if (!src) return prev
      const now = Date.now()
      const copy = createConversation(src.projectId)
      return {
        ...prev,
        conversations: [
          ...prev.conversations,
          {
            ...copy,
            title: `${src.title}（副本）`,
            messages: src.messages.map((m) => ({
              ...m,
              id: uid("msg"),
              streaming: false,
            })),
            createdAt: now,
            updatedAt: now,
          },
        ],
        activeProjectId: src.projectId,
        activeConversationId: copy.id,
      }
    })
  }, [setState])

  /* ---------------- 收藏 ---------------- */

  const toggleFavorite = useCallback((convId: string, messageId: string) => {
    setState((prev) => {
      const existing = prev.favorites.find(
        (f) => f.conversationId === convId && f.messageId === messageId
      )
      if (existing) {
        return {
          ...prev,
          favorites: prev.favorites.filter((f) => f.id !== existing.id),
        }
      }
      return {
        ...prev,
        favorites: [
          ...prev.favorites,
          createFavorite(convId, messageId),
        ],
      }
    })
  }, [setState])

  /** 给收藏项设置标签 */
  const setFavoriteTags = useCallback(
    (favoriteId: string, tagIds: string[]) => {
      setState((prev) => ({
        ...prev,
        favorites: prev.favorites.map((f) =>
          f.id === favoriteId ? { ...f, tagIds } : f
        ),
      }))
    },
    [setState]
  )

  /** 设置收藏备注 */
  const setFavoriteNote = useCallback((favoriteId: string, note: string) => {
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.map((f) =>
        f.id === favoriteId ? { ...f, note } : f
      ),
    }))
  }, [setState])

  /** 原子地「收藏并写入备注」：已收藏则更新备注，未收藏则新建 */
  const favoriteWithNote = useCallback(
    (convId: string, messageId: string, note: string) => {
      setState((prev) => {
        const existing = prev.favorites.find(
          (f) => f.conversationId === convId && f.messageId === messageId
        )
        if (existing) {
          return {
            ...prev,
            favorites: prev.favorites.map((f) =>
              f.id === existing.id ? { ...f, note } : f
            ),
          }
        }
        return {
          ...prev,
          favorites: [
            ...prev.favorites,
            { ...createFavorite(convId, messageId), note },
          ],
        }
      })
    },
    [setState]
  )

  /** 批量取消收藏 */
  const removeFavorites = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.filter((f) => !set.has(f.id)),
    }))
  }, [setState])

  /** 批量打标签 */
  const tagFavorites = useCallback((ids: string[], tagId: string) => {
    const set = new Set(ids)
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.map((f) =>
        set.has(f.id) && !f.tagIds.includes(tagId)
          ? { ...f, tagIds: [...f.tagIds, tagId] }
          : f
      ),
    }))
  }, [setState])

  /* ---------------- 标签 ---------------- */

  const addTag = useCallback((name: string): string | null => {
    const trimmed = name.trim()
    if (!trimmed) return null
    let newId: string | null = null
    setState((prev) => {
      if (prev.tags.some((t) => t.name === trimmed)) return prev
      const id = uid("tag")
      newId = id
      return {
        ...prev,
        tags: [
          ...prev.tags,
          { id, name: trimmed, hue: TAG_HUES[prev.tags.length % TAG_HUES.length] },
        ],
      }
    })
    return newId
  }, [setState])

  const renameTag = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setState((prev) => ({
      ...prev,
      tags: prev.tags.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    }))
  }, [setState])

  /** 删除标签，并从所有收藏项上摘除 */
  const deleteTag = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t.id !== id),
      favorites: prev.favorites.map((f) =>
        f.tagIds.includes(id)
          ? { ...f, tagIds: f.tagIds.filter((t) => t !== id) }
          : f
      ),
    }))
  }, [setState])

  /** 标签使用计数 */
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of state.favorites) {
      for (const t of f.tagIds) map.set(t, (map.get(t) ?? 0) + 1)
    }
    return map
  }, [state.favorites])

  /* ---------------- 画板 ---------------- */

  /** 当前项目可用的画板（含跨项目共享的，projectId 为 null） */
  const projectBoards = useMemo(
    () =>
      state.boards
        .filter(
          (b) =>
            b.projectId === null || b.projectId === state.activeProjectId
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.boards, state.activeProjectId]
  )

  const activeBoard = useMemo(
    () => state.boards.find((b) => b.id === state.activeBoardId) ?? null,
    [state.boards, state.activeBoardId]
  )

  /**
   * 根据画板 id 取展示名。
   *
   * 多个入口（多选栏、划词浮层、消息动作条）都要把 id 换成提示文案，
   * 回退字统一放在这里，避免各处写不一致的默认值。
   */
  const boardName = useCallback(
    (boardId: string | null | undefined, fallback = "画板"): string =>
      state.boards.find((b) => b.id === boardId)?.name ?? fallback,
    [state.boards]
  )

  /** 当前画板的节点 + 解析后的源消息 */
  const boardNodeEntries = useMemo((): BoardNodeEntry[] => {
    if (!activeBoard) return []
    const out: BoardNodeEntry[] = []
    for (const node of state.boardNodes) {
      if (node.boardId !== activeBoard.id) continue
      if (node.kind === "note") {
        out.push({ node, message: undefined, conversation: undefined, text: node.note ?? "" })
        continue
      }
      const conv = state.conversations.find(
        (c) => c.id === node.ref?.conversationId
      )
      const message = conv?.messages.find((m) => m.id === node.ref?.messageId)
      out.push({
        node,
        message,
        conversation: conv,
        text: node.excerpt || message?.content || "",
      })
    }
    return out
  }, [activeBoard, state.boardNodes, state.conversations])

  /** 当前画板的任务列表 */
  const projectTasks = useMemo(
    () =>
      activeBoard
        ? state.boardTasks.filter((t) => t.boardId === activeBoard.id)
        : [],
    [activeBoard, state.boardTasks]
  )

  const activeTask = useMemo(
    () => state.boardTasks.find((t) => t.id === state.activeTaskId) ?? null,
    [state.boardTasks, state.activeTaskId]
  )

  /** 当前画板的连线 */
  const boardEdges = useMemo(
    () =>
      activeBoard
        ? state.boardEdges.filter((e) => e.boardId === activeBoard.id)
        : [],
    [activeBoard, state.boardEdges]
  )

  const setMainView = useCallback((view: ChatState["mainView"]) => {
    setState((prev) => ({ ...prev, mainView: view }))
  }, [setState])

  /** 新建画板并切换过去，若当前项目已有画板则直接切换 */
  const addBoard = useCallback((name?: string): Board => {
    const board = createBoard(null, name?.trim() || "新画板")
    setState((prev) => ({
      ...withBoardGc(prev),
      boards: [...prev.boards, board],
      activeBoardId: board.id,
      mainView: "board",
    }))
    return board
  }, [setState])

  const selectBoard = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      activeBoardId: id,
      mainView: "board",
    }))
  }, [setState])

  const renameBoard = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      boards: prev.boards.map((b) =>
        b.id === id ? { ...b, name: name.trim() || b.name } : b
      ),
    }))
  }, [setState])

  /** 删除画板及其全部节点与连线 */
  const deleteBoard = useCallback((id: string) => {
    setState((prev) => {
      const boards = prev.boards.filter((b) => b.id !== id)
      return {
        ...prev,
        boards,
        boardNodes: prev.boardNodes.filter((n) => n.boardId !== id),
        boardEdges: prev.boardEdges.filter((e) => e.boardId !== id),
        activeBoardId:
          prev.activeBoardId === id ? (boards[0]?.id ?? null) : prev.activeBoardId,
      }
    })
  }, [setState])

  /**
   * 新卡片落点：统一入口。
   *
   * 输入「当前画板的卡片」与「这条消息的上下文」，输出一个**不与任何现有卡片
   * 重叠**的坐标。分支消息优先贴到父卡片右侧，否则接在同对话上一条下方，
   * 再否则由 placeCard 全画布扫描空位。
   *
   * 纯几何计算，不碰 store——写成纯函数才能单测。
   */
  const planPlacement = useCallback(
    (
      siblings: BoardNode[],
      args: {
        conversationId?: string
        messageId?: string
        /** 本批次已排好的新卡片，参与避让 */
        occupied?: Slot[]
      }
    ): { x: number; y: number } => {
      const size = { width: BOARD_NODE_W_DEFAULT, height: BOARD_NODE_H_DEFAULT }
      const slots: Slot[] = siblings.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        width: n.width ?? size.width,
        height: n.height ?? size.height,
      }))

      let anchor: string | null = null
      let relation: "branch" | "chain" | undefined
      if (args.conversationId && args.messageId) {
        const refCards = siblings.map((n) => ({ id: n.id, ref: n.ref }))
        const branch = findBranchParent(
          args.conversationId,
          args.messageId,
          stateRef.current.conversations,
          refCards
        )
        if (branch) {
          anchor = branch
          relation = "branch"
        } else {
          const prev = findPreviousCard(
            args.conversationId,
            args.messageId,
            stateRef.current.conversations,
            refCards
          )
          if (prev) {
            anchor = prev
            relation = "chain"
          }
        }
      }

      return placeCard({
        cards: slots,
        slots,
        occupied: args.occupied ?? [],
        size,
        anchor,
        relation,
        gap: LAYOUT_GAP,
      })
    },
    []
  )

  /**
   * 批量把多条消息加入指定画板。
   * 返回实际新增 / 跳过的数量，供 UI 给出准确提示（而不是笼统的「已加入」）。
   */
  const addMessagesToBoard = useCallback(
    (
      conversationId: string,
      messageIds: string[],
      boardId: string
    ): { added: number; skipped: number } => {
      let added = 0
      let skipped = 0
      setState((prev) => {
        const exists = new Set(
          prev.boardNodes
            .filter((n) => n.boardId === boardId && n.ref)
            .map((n) => `${n.ref!.conversationId}:${n.ref!.messageId}`)
        )
        const siblings = prev.boardNodes.filter((n) => n.boardId === boardId)
        const fresh: BoardNode[] = []
        // 同批次已排好的卡片要参与避让，否则整批会跳到同一个点上
        const occupied: Slot[] = []
        for (const messageId of messageIds) {
          const key = `${conversationId}:${messageId}`
          if (exists.has(key)) {
            skipped++
            continue
          }
          exists.add(key)
          const at = planPlacement(siblings, { conversationId, messageId, occupied })
          const node = createBoardNode(boardId, { conversationId, messageId }, at)
          fresh.push(node)
          occupied.push({
            id: node.id,
            x: at.x,
            y: at.y,
            width: node.width ?? BOARD_NODE_W_DEFAULT,
            height: node.height ?? BOARD_NODE_H_DEFAULT,
          })
        }
        added = fresh.length
        if (fresh.length === 0) return prev
        return {
          ...prev,
          boardNodes: [...prev.boardNodes, ...fresh],
          activeBoardId: boardId,
          boards: prev.boards.map((b) =>
            b.id === boardId ? { ...b, updatedAt: Date.now() } : b
          ),
        }
      })
      return { added, skipped }
    },
    [setState, planPlacement]
  )

  /**
   * 把消息加入画板：已存在则只聚焦（不重复创建）。
   * 落点由 planPlacement 计算，保证不与已有卡片重叠。
   */
  const addMessageToBoard = useCallback(
    (
      conversationId: string,
      messageId: string,
      boardId?: string,
      excerpt?: string
    ): boolean => {
      let created = false
      setState((prev) => {
        const targetBoardId = boardId ?? prev.activeBoardId
        if (!targetBoardId) return prev
        const exists = prev.boardNodes.some(
          (n) =>
            n.boardId === targetBoardId &&
            n.ref?.conversationId === conversationId &&
            n.ref?.messageId === messageId
        )
        if (exists) return prev
        const siblings = prev.boardNodes.filter(
          (n) => n.boardId === targetBoardId
        )
        const at = planPlacement(siblings, { conversationId, messageId })
        const node = createBoardNode(
          targetBoardId,
          { conversationId, messageId },
          at,
          excerpt
        )
        created = true
        return {
          ...prev,
          boardNodes: [...prev.boardNodes, node],
          boards: prev.boards.map((b) =>
            b.id === targetBoardId ? { ...b, updatedAt: Date.now() } : b
          ),
        }
      })
      return created
    },
    [setState, planPlacement]
  )

  /**
   * 「一键加入画板」：在 addMessageToBoard 之上处理两种常见情况并给出提示。
   *
   * 1) 当前没有画板 → 先建一个再加入；
   * 2) 消息已存在 → 提示而不是默默忽略。
   * 消息动作条与画板面板的「添加单条消息」都用它，避免两处文案与分支漂移。
   */
  const addMessageToBoardSmart = useCallback(
    (conversationId: string, messageId: string): boolean => {
      const targetBoardId = stateRef.current.activeBoardId ?? addBoard().id
      const ok = addMessageToBoard(conversationId, messageId, targetBoardId)
      toast[ok ? "success" : "info"](ok ? "已加入画板" : "该消息已在画板上")
      return ok
    },
    [addBoard, addMessageToBoard]
  )


  /**
   * 把一段选中文字摘录进画板。
   * 与 addMessageToBoard 的区别：节点只装片段（excerpt），但仍保留对源消息的引用，
   * 因此既能溯源，又不会被整段长回答撑爆画布。
   */
  const addExcerptToBoard = useCallback(
    (
      conversationId: string,
      messageId: string,
      excerpt: string,
      boardId: string
    ): boolean => {
      let created = false
      const body = excerpt.trim()
      if (!body) return false
      setState((prev) => {
        const siblings = prev.boardNodes.filter((n) => n.boardId === boardId)
        const at = planPlacement(siblings, { conversationId, messageId })
        const node = createBoardNode(
          boardId,
          { conversationId, messageId },
          at,
          body
        )
        created = true
        return {
          ...prev,
          boardNodes: [...prev.boardNodes, node],
          activeBoardId: boardId,
          boards: prev.boards.map((b) =>
            b.id === boardId ? { ...b, updatedAt: Date.now() } : b
          ),
        }
      })
      return created
    },
    [setState]
  )

  /** 把整段对话按消息顺序铺成一条链，适合先得到骨架再整理 */
  const addConversationToBoard = useCallback(
    (conversationId: string, boardId?: string): number => {
      let count = 0
      setState((prev) => {
        const targetBoardId = boardId ?? prev.activeBoardId
        const conv = prev.conversations.find((c) => c.id === conversationId)
        if (!targetBoardId || !conv) return prev
        const existing = prev.boardNodes.filter(
          (n) => n.boardId === targetBoardId
        )
        const seen = new Set(
          existing
            .map((n) =>
              n.ref
                ? `${n.ref.conversationId}:${n.ref.messageId}`
                : null
            )
            .filter(Boolean) as string[]
        )
        const fresh = conv.messages.filter((m) => !seen.has(`${conversationId}:${m.id}`))
        if (fresh.length === 0) return prev

        /*
         * 提问靠左、回答靠右，纵向交错成之字形——这是用户要的「提示词与回答
         * 交错」形态：像聊天记录一样，一眼能看出哪句是问、哪句是答。
         *
         * 交给纯函数算坐标，store 只负责落地。
         */
        const size = { width: BOARD_NODE_W_DEFAULT, height: BOARD_NODE_H_DEFAULT }
        const points = placeChat({
          items: fresh.map((m) => ({ role: m.role, size })),
          cards: existing.map((n) => ({
            x: n.x,
            y: n.y,
            width: n.width ?? size.width,
            height: n.height ?? size.height,
          })),
          gap: LAYOUT_GAP,
        })

        const added: BoardNode[] = fresh.map((m, i) => {
          seen.add(`${conversationId}:${m.id}`)
          return createBoardNode(
            targetBoardId,
            { conversationId, messageId: m.id },
            points[i] ?? { x: 0, y: 0 }
          )
        })
        if (added.length === 0) return prev
        count = added.length
        // 同一条对话相邻消息自动连 reference 边，形成骨架
        const edges = [...prev.boardEdges]
        for (let i = 1; i < added.length; i++) {
          edges.push(
            createBoardEdge(
              targetBoardId,
              added[i - 1].id,
              added[i].id,
              "reference"
            )
          )
        }
        return {
          ...prev,
          boardNodes: [...prev.boardNodes, ...added],
          boardEdges: edges,
          boards: prev.boards.map((b) =>
            b.id === targetBoardId ? { ...b, updatedAt: Date.now() } : b
          ),
        }
      })
      return count
    },
    [setState]
  )

  /** 新建便签 */
  const addNote = useCallback((text: string, boardId?: string) => {
    setState((prev) => {
      const targetBoardId = boardId ?? prev.activeBoardId
      if (!targetBoardId) return prev
      const siblings = prev.boardNodes.filter(
        (n) => n.boardId === targetBoardId
      )
      // 便签没有分支关系，直接找一个不与现有卡片重叠的空位
      const at = planPlacement(siblings, {})
      const node = createNoteNode(targetBoardId, text, at.x, at.y)
      return {
        ...prev,
        boardNodes: [...prev.boardNodes, node],
        boards: prev.boards.map((b) =>
          b.id === targetBoardId ? { ...b, updatedAt: Date.now() } : b
        ),
      }
    })
  }, [setState])

  /**
   * 拖拽结束才提交坐标。
   * 中途的 mousemove 不能进 state，否则每次移动都会序列化整个应用状态。
   */
  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setState((prev) => {
      const target = prev.boardNodes.find((n) => n.id === nodeId)
      if (!target) return prev
      if (Math.round(target.x) === Math.round(x) && Math.round(target.y) === Math.round(y)) {
        return prev
      }
      return {
        ...prev,
        boardNodes: prev.boardNodes.map((n) =>
          n.id === nodeId ? { ...n, x, y } : n
        ),
      }
    })
  }, [setState])

  const updateNode = useCallback(
    (
      nodeId: string,
      patch: Partial<
        Pick<
          BoardNode,
          "title" | "note" | "excerpt" | "expanded" | "width" | "height" | "contentOverride"
        >
      >
    ) => {
      setState((prev) => ({
        ...prev,
        boardNodes: prev.boardNodes.map((n) =>
          n.id === nodeId ? { ...n, ...patch } : n
        ),
      }))
    },
    [setState]
  )

  const removeNodes = useCallback((nodeIds: string[]) => {
    const set = new Set(nodeIds)
    setState((prev) => ({
      ...prev,
      boardNodes: prev.boardNodes.filter((n) => !set.has(n.id)),
      boardEdges: prev.boardEdges.filter(
        (e) => !set.has(e.from) && !set.has(e.to)
      ),
    }))
  }, [setState])

  /** 连接两个节点；不允许自环与重复边 */
  /**
   * 连接两个节点。
   * 新建的线默认是 flow（可执行），因为画板的主要用途就是「材料→提示词→输出」；
   * 想要纯视觉联系时用户可以在边菜单里改成「仅联系」。
   */
  const connectNodes = useCallback(
    (
      from: string,
      to: string,
      handles?: { sourceHandle?: string; targetHandle?: string }
    ) => {
      setState((prev) => {
        if (from === to) return prev
        const dup = prev.boardEdges.some((e) => e.from === from && e.to === to)
        if (dup) return prev
        const source = prev.boardNodes.find((n) => n.id === from)
        if (!source) return prev
        return {
          ...prev,
          boardEdges: [
            ...prev.boardEdges,
            createBoardEdge(source.boardId, from, to, "flow", handles),
          ],
        }
      })
    },
    [setState]
  )

  const removeEdge = useCallback((edgeId: string) => {
    setState((prev) => ({
      ...prev,
      boardEdges: prev.boardEdges.filter((e) => e.id !== edgeId),
      boardTasks: prev.boardTasks.map((t) =>
        t.edgeIds.includes(edgeId)
          ? { ...t, edgeIds: t.edgeIds.filter((id) => id !== edgeId) }
          : t
      ),
    }))
  }, [setState])

  /* ---------------- 连线编辑 ---------------- */

  const updateEdge = useCallback(
    (
      edgeId: string,
      patch: Partial<
        Pick<BoardEdge, "prompt" | "enabled" | "kind" | "label" | "promptHue">
      >
    ) => {
      setState((prev) => ({
        ...prev,
        boardEdges: prev.boardEdges.map((e) =>
          e.id === edgeId ? { ...e, ...patch } : e
        ),
      }))
    },
    [setState]
  )

  /** 切换「可执行 / 仅联系」 */
  const toggleEdgeKind = useCallback((edgeId: string) => {
    setState((prev) => ({
      ...prev,
      boardEdges: prev.boardEdges.map((e) =>
        e.id === edgeId
          ? { ...e, kind: e.kind === "flow" ? "manual" : "flow" }
          : e
      ),
    }))
  }, [setState])

  const toggleEdgeEnabled = useCallback((edgeId: string) => {
    setState((prev) => ({
      ...prev,
      boardEdges: prev.boardEdges.map((e) =>
        e.id === edgeId ? { ...e, enabled: e.enabled === false } : e
      ),
    }))
  }, [setState])

  /* ---------------- 任务 ---------------- */

  const addTask = useCallback((name?: string): BoardTask | null => {
    let created: BoardTask | null = null
    setState((prev) => {
      if (!prev.activeBoardId) return prev
      const task = createBoardTask(prev.activeBoardId, name || "新任务")
      created = task
      return {
        ...prev,
        boardTasks: [...prev.boardTasks, task],
        activeTaskId: task.id,
      }
    })
    return created
  }, [setState])

  const renameTask = useCallback((taskId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      boardTasks: prev.boardTasks.map((t) =>
        t.id === taskId ? { ...t, name: name.trim() || t.name, updatedAt: Date.now() } : t
      ),
    }))
  }, [setState])

  const deleteTask = useCallback((taskId: string) => {
    setState((prev) => {
      const tasks = prev.boardTasks.filter((t) => t.id !== taskId)
      return {
        ...prev,
        boardTasks: tasks,
        activeTaskId:
          prev.activeTaskId === taskId ? (tasks[0]?.id ?? null) : prev.activeTaskId,
      }
    })
  }, [setState])

  const selectTask = useCallback((taskId: string | null) => {
    setState((prev) => ({ ...prev, activeTaskId: taskId }))
  }, [setState])

  /** 把边加入 / 移出任务 */
  const toggleTaskEdge = useCallback((taskId: string, edgeId: string) => {
    setState((prev) => ({
      ...prev,
      boardTasks: prev.boardTasks.map((t) => {
        if (t.id !== taskId) return t
        const has = t.edgeIds.includes(edgeId)
        return {
          ...t,
          edgeIds: has
            ? t.edgeIds.filter((id) => id !== edgeId)
            : [...t.edgeIds, edgeId],
          updatedAt: Date.now(),
        }
      }),
    }))
  }, [setState])

  /* ---------------- 颜色标记 ---------------- */

  const setNodeHue = useCallback((nodeId: string, hue: number | undefined) => {
    setState((prev) => ({
      ...prev,
      boardNodes: prev.boardNodes.map((n) => (n.id === nodeId ? { ...n, hue } : n)),
    }))
  }, [setState])

  const setEdgeHue = useCallback((edgeId: string, hue: number | undefined) => {
    setState((prev) => ({
      ...prev,
      boardEdges: prev.boardEdges.map((e) => (e.id === edgeId ? { ...e, hue } : e)),
    }))
  }, [setState])

  const setConversationHue = useCallback(
    (conversationId: string, hue: number | undefined) => {
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversationId ? { ...c, hue } : c
        ),
      }))
    },
    [setState]
  )

  const setSidebarView = useCallback((view: ChatState["sidebarView"]) => {
    setState((prev) => ({ ...prev, sidebarView: view }))
  }, [setState])

  /* ---------------- 搜索 ---------------- */

  /** 按标题与消息内容搜索当前项目下的对话 */
  const searchConversations = useCallback(
    (query: string): Conversation[] => {
      const q = query.trim().toLowerCase()
      if (!q) return []
      return state.conversations.filter(
        (c) =>
          c.projectId === state.activeProjectId &&
          (c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q)))
      )
    },
    [state.conversations, state.activeProjectId]
  )

  /* ---------------- 设置 ---------------- */
  const updateSettings = useCallback(
    (
      patch: Partial<
        Pick<ChatState, "apiKey" | "baseUrl" | "model" | "thinkingEnabled">
      >
    ) => {
      setState((prev) => ({ ...prev, ...patch }))
    },
    [setState]
  )

  /* ---------------- 发消息 ---------------- */

  const updateMessages = useCallback(
    (convId: string, fn: (messages: Message[]) => Message[]) => {
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === convId ? { ...c, messages: fn(c.messages) } : c
        ),
      }))
    },
    [setState]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /**
   * 发送一条用户消息并流式接收回复。
   *
   * `override` 用于「重新生成」：调用方已经算好了截断后的历史，
   * 需要把它直接交给 send，而不是让 send 再读一次 state 闭包。
   * 否则 setState 与 await send 之间会读到截断**前**的旧历史，
   * 导致最后一条提问被发送两遍、旧回答仍留在上下文里。
   */
  const send = useCallback(
    async (
      text: string,
      override?: { conversationId: string; history: Message[] }
    ) => {
      const content = text.trim()
      if (!content || streamingConvId) return

      // 1) 先在当前 state 上同步计算目标会话与历史，
      //    不能依赖 setState updater 里的赋值（并发渲染下 updater 可能延迟执行）
      let targetConvId = override?.conversationId ?? state.activeConversationId
      let targetProjectId = state.activeProjectId
      let created: Conversation | null = null

      if (!targetConvId) {
        if (!targetProjectId) {
          toast.error("还没有项目，请先在左侧新建一个项目")
          return
        }
        created = createConversation(targetProjectId)
        targetConvId = created.id
      }

      // override 路径下会话一定已存在，直接用调用方给的快照
      const sourceConv =
        created ?? state.conversations.find((c) => c.id === targetConvId)!
      const history = override?.history ?? sourceConv.messages
      const resolvedConvId: string = targetConvId

      const userMsg = newMessage("user", content)
      const reply: Message = { ...newMessage("assistant", ""), streaming: true }

      setState((prev) => {
        const exists = prev.conversations.some((c) => c.id === resolvedConvId)
        const conversations = exists
          ? prev.conversations
          : [...prev.conversations, created!]
        return {
          ...prev,
          conversations: conversations.map((c) =>
            c.id === resolvedConvId
              ? {
                  ...c,
                  messages: [...c.messages, userMsg, reply],
                  title:
                    c.messages.length === 0 ? nextTitle([userMsg]) : c.title,
                  updatedAt: Date.now(),
                }
              : c
          ),
        }
      })

      // 2) 节流写出增量，避免每个 token 都触发整棵树重渲染
      let pendingContent = ""
      let pendingReasoning = ""
      let rafId: number | null = null
      const flush = () => {
        if (!pendingContent && !pendingReasoning) return
        const chunk = pendingContent
        const rChunk = pendingReasoning
        pendingContent = ""
        pendingReasoning = ""
        updateMessages(targetConvId, (messages) => {
          const idx = messages.findLastIndex(
            (m) => m.role === "assistant" && m.streaming
          )
          if (idx === -1) return messages
          const next = messages.slice()
          next[idx] = {
            ...next[idx],
            content: next[idx].content + chunk,
            reasoning: (next[idx].reasoning ?? "") + rChunk,
          }
          return next
        })
      }
      const scheduleFlush = () => {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          flush()
        })
      }

      const controller = new AbortController()
      abortRef.current = controller
      setStreamingConvId(targetConvId)

      let aborted = false

      try {
        await streamChat({
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
          model: state.model,
          thinkingEnabled: state.thinkingEnabled !== false,
          messages: [...history, newMessage("user", content)],
          signal: controller.signal,
          onDelta: (delta) => {
            pendingContent += delta
            scheduleFlush()
          },
          onReasoning: (delta) => {
            pendingReasoning += delta
            scheduleFlush()
          },
        })
      } catch (err) {
        aborted = (err as Error)?.name === "AbortError"
        if (!aborted) {
          const message = err instanceof Error ? err.message : String(err)
          // 未配置 Key 时给出可操作提示，避免只显示空白回复
          const missingKey = !state.apiKey.trim()
          toast.error(message, {
            duration: missingKey ? 10000 : 6000,
            action: missingKey
              ? { label: "去设置", onClick: () => openSettingsRef.current?.() }
              : undefined,
          })
          updateMessages(targetConvId, (messages) =>
            messages.map((m) =>
              m.role === "assistant" && m.streaming
                ? { ...m, streaming: false, error: message }
                : m
            )
          )
        }
      } finally {
        if (rafId !== null) cancelAnimationFrame(rafId)
        flush()
        updateMessages(targetConvId, (messages) =>
          messages.map((m) =>
            m.role === "assistant" && m.streaming
              ? {
                  ...m,
                  streaming: false,
                  content:
                    !m.content && aborted ? "（已停止生成）" : m.content,
                }
              : m
          )
        )
        setState((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === targetConvId ? { ...c, updatedAt: Date.now() } : c
          ),
        }))
        abortRef.current = null
        setStreamingConvId(null)
      }
    },
    [
      state.apiKey,
      state.baseUrl,
      state.model,
      state.thinkingEnabled,
      state.activeConversationId,
      state.activeProjectId,
      state.conversations,
      streamingConvId,
      updateMessages,
      setState,
    ]
  )

  /**
   * 重新生成。
   *
   * 不传 messageId 时作用于最后一条问答；传 messageId 时从该消息处就开新。
   * 历史统一从 stateRef 取最新值，并把截断后的结果显式传给 send，
   * 避免 send 读到本轮 render 的旧 state 闭包（否则提问会重复进上下文）。
   */
  const regenerate = useCallback(
    async (conv: Conversation, messageId?: string) => {
      if (streamingConvId) return

      // 以 ref 为准，避免外部传入的 conv 已经过期
      const latestConv =
        stateRef.current.conversations.find((c) => c.id === conv.id) ?? conv
      const msgs = latestConv.messages

      /*
       * 确定要重跑的哪一条 user 提问：
       *  - 指定了 messageId：取该位置及之前最后一条 user
       *  - 否则：取全段最后一条 user
       */
      const anchorIdx = messageId
        ? msgs.findIndex((m) => m.id === messageId)
        : msgs.length - 1
      if (anchorIdx === -1) return

      let userIdx = -1
      for (let i = anchorIdx; i >= 0; i--) {
        if (msgs[i].role === "user") {
          userIdx = i
          break
        }
      }
      if (userIdx === -1) return

      const lastUser = msgs[userIdx]
      // 截断到这条提问之前；send 会重新追加这条提问
      const trimmed = msgs.slice(0, userIdx)

      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === latestConv.id
            ? { ...c, messages: trimmed, updatedAt: Date.now() }
            : c
        ),
      }))

      // 关键：把截断后的历史显式交给 send
      await send(lastUser.content, {
        conversationId: latestConv.id,
        history: trimmed,
      })
    },
    [send, streamingConvId, setState]
  )

  /**
   * 从指定消息处分支出一个新对话（复制式分支）。
   * 新对话包含该消息及其之前的全部历史，与源对话从此独立。
   */
  const branchFrom = useCallback(
    (
      convId: string,
      messageId: string,
      options?: {
        /** 追加到分支末尾的消息（如悬浮追问的问答） */
        append?: Array<{ role: "user" | "assistant"; content: string }>
        /** 覆盖分支标题 */
        title?: string
        /** 是否跳转过去，默认 true */
        activate?: boolean
      }
    ) => {
      let newConvId: string | null = null
      const append = options?.append ?? []
      const activate = options?.activate ?? true

      setState((prev) => {
        const source = prev.conversations.find((c) => c.id === convId)
        if (!source) return prev

        const cutIndex = source.messages.findIndex((m) => m.id === messageId)
        if (cutIndex === -1) return prev

        const inherited = source.messages.slice(0, cutIndex + 1)
        const now = Date.now()
        const branch = createConversation(source.projectId)
        newConvId = branch.id

        const extra: Message[] = append.map((a) => ({
          ...newMessage(a.role, a.content),
          createdAt: now,
        }))

        return {
          ...prev,
          conversations: [
            ...prev.conversations,
            {
              ...branch,
              // 深拷贝并重新分配 id，避免分支间引用同一消息对象
              messages: [
                ...inherited.map((m) => ({
                  ...m,
                  id: uid("msg"),
                  streaming: false,
                })),
                ...extra,
              ],
              title:
                options?.title ??
                (append.length > 0
                  ? `${source.title}（追问）`
                  : `${source.title}（分支）`),
              createdAt: now,
              updatedAt: now,
              branchedFrom: {
                conversationId: source.id,
                conversationTitle: source.title,
                messageId,
              },
            },
          ],
          activeProjectId: source.projectId,
          activeConversationId: activate ? branch.id : prev.activeConversationId,
        }
      })

      return newConvId
    },
    [setState]
  )

  /* ---------------- 执行任务 ---------------- */

  /**
   * 解析节点的可读文本：改写优先，其次摘录，最后源消息。
   * 画板节点只存引用或摘录，真正要送给模型的内容需要在这里统一拼出。
   */
  const nodeText = useCallback(
    (node: BoardNode): string => resolveNodeText(node, state.conversations),
    [state.conversations]
  )

  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)

  /**
   * 执行单条线（内部实现）。
   *
   * runEdge 与 runTask 都走这里，保证「单跑一条」与「任务里跑这条」行为完全一致。
   * 返回值用来让调用方汇总成功/失败数量。
   *
   * 刻意不做拓扑串联：边是独立单元，一条失败不影响其他边，
   * 结果各自写回自己的终点节点。这样「只跑一条」和「跑多条」是同一套语义。
   */
  const execEdge = useCallback(
    async (
      edge: BoardEdge,
      opts: {
        signal: AbortSignal
        writtenTargets: Set<string>
      }
    ): Promise<"ok" | "failed" | "aborted"> => {
      const latest = stateRef.current
      const source = latest.boardNodes.find((n) => n.id === edge.from)
      const target = latest.boardNodes.find((n) => n.id === edge.to)
      if (!source || !target) return "failed"

      const inputText = resolveNodeText(source, latest.conversations)
      if (!inputText.trim()) return "failed"

      const prompt = (edge.prompt ?? "").trim()
      const content = prompt
        ? `【材料】\n${inputText}\n\n【要求】\n${prompt}`
        : inputText

      const runId = uid("run")
      const snapshot = {
        edgeId: edge.id,
        prompt,
        inputs: [
          { nodeId: source.id, title: source.title || source.kind, text: inputText },
        ],
        createdAt: Date.now(),
      }

      try {
        const result = await streamChat({
          apiKey: latest.apiKey,
          baseUrl: latest.baseUrl,
          model: latest.model,
          thinkingEnabled: latest.thinkingEnabled !== false,
          messages: [{ id: runId, role: "user", content, createdAt: Date.now() }],
          signal: opts.signal,
          onDelta: () => {},
        })

        const run: NodeRun = { id: runId, ...snapshot, output: result.content }
        const isFirstWrite = !opts.writtenTargets.has(target.id)
        opts.writtenTargets.add(target.id)
        setState((prev) => ({
          ...prev,
          boardNodes: prev.boardNodes.map((n) => {
            if (n.id !== target.id) return n
            const prevRuns = n.runs ?? []
            // 同一节点被多条线写入时拼接，保留各自产出
            const nextContent = isFirstWrite
              ? result.content
              : `${n.contentOverride ?? ""}\n\n---\n\n${
                  prompt ? `**${prompt}**\n\n` : ""
                }${result.content}`
            return {
              ...n,
              contentOverride: nextContent,
              runs: [run, ...prevRuns].slice(0, 50),
            }
          }),
        }))
        return "ok"
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return "aborted"
        const message = err instanceof Error ? err.message : String(err)
        setState((prev) => ({
          ...prev,
          boardNodes: prev.boardNodes.map((n) => {
            if (n.id !== target.id) return n
            const run: NodeRun = { id: runId, ...snapshot, output: "", error: message }
            return { ...n, runs: [run, ...(n.runs ?? [])].slice(0, 50) }
          }),
        }))
        return "failed"
      }
    },
    [setState]
  )

  /** 准备工作：校验 Key、构造 controller */
  const beginRun = useCallback((runId: string): AbortController | null => {
    const latest = stateRef.current
    if (!latest.apiKey.trim()) {
      toast.error("请先在设置里填写 DeepSeek API Key", {
        action: { label: "去设置", onClick: () => openSettingsRef.current?.() },
      })
      return null
    }
    const controller = new AbortController()
    abortRef.current = controller
    setRunningTaskId(runId)
    return controller
  }, [])

  /**
   * 直接执行单条线，无需创建任务。
   * 快捷键 Enter / Ctrl+Enter 与边编辑器里的「立即执行」都调用它。
   */
  const runEdge = useCallback(
    async (edgeId: string) => {
      if (streamingConvId || runningTaskId) return
      const edge = state.boardEdges.find((e) => e.id === edgeId)
      if (!edge || !isRunnableEdge(edge)) {
        toast.info("这条线不可执行（需要是「可执行」且未被禁用）")
        return
      }

      const controller = beginRun(`edge:${edgeId}`)
      if (!controller) return

      try {
        const r = await execEdge(edge, {
          signal: controller.signal,
          writtenTargets: new Set(),
        })
        if (r === "ok") toast.success("已执行这一条线")
        else if (r === "aborted") toast.info("已停止")
        else toast.error("执行失败，可到节点历史里查看原因")
      } finally {
        abortRef.current = null
        setRunningTaskId(null)
      }
    },
    [state.boardEdges, streamingConvId, runningTaskId, beginRun, execEdge]
  )

  /**
   * 执行任务：对任务内每条可执行的 flow 边逐条发请求。
   *
   * 多条边指向同一终点时会累积写入（见 execEdge 的 writtenTargets），
   * 不在任务层重复这个逻辑。
   */
  const runTask = useCallback(
    async (taskId: string) => {
      if (streamingConvId || runningTaskId) return
      const task = state.boardTasks.find((t) => t.id === taskId)
      if (!task) return

      const runnable = task.edgeIds
        .map((id) => state.boardEdges.find((e) => e.id === id))
        .filter((e): e is BoardEdge => !!e && isRunnableEdge(e))

      if (runnable.length === 0) {
        toast.info("任务里没有可执行的线（需要是「可执行」且未被禁用）")
        return
      }

      const controller = beginRun(taskId)
      if (!controller) return

      /**
       * 本次运行中已经向哪个节点写过结果。
       * 多条线指向同一终点时（材料汇聚对比），结果要按顺序拼接而不是互相覆盖。
       */
      const writtenTargets = new Set<string>()

      let ok = 0
      let failed = 0
      let aborted = false

      try {
        for (const edge of runnable) {
          const r = await execEdge(edge, {
            signal: controller.signal,
            writtenTargets,
          })
          if (r === "ok") ok++
          else if (r === "aborted") {
            aborted = true
            break
          } else failed++
        }
      } finally {
        abortRef.current = null
        setRunningTaskId(null)
      }

      if (aborted) {
        toast.info(`已停止，完成了 ${ok} 条线`)
      } else if (ok > 0 && failed === 0) {
        toast.success(`已执行 ${ok} 条线`)
      } else if (ok > 0) {
        toast.warning(`成功 ${ok} 条，失败 ${failed} 条`)
      } else if (failed > 0) {
        toast.error(`${failed} 条线执行失败`)
      }
    },
    [
      state.boardTasks,
      state.boardEdges,
      streamingConvId,
      runningTaskId,
      beginRun,
      execEdge,
    ]
  )

  const stopTask = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunningTaskId(null)
  }, [])

  /** 回填某条历史到节点当前内容 */
  const applyRun = useCallback((nodeId: string, runId: string) => {
    setState((prev) => ({
      ...prev,
      boardNodes: prev.boardNodes.map((n) => {
        if (n.id !== nodeId) return n
        const run = n.runs?.find((r) => r.id === runId)
        if (!run) return n
        return { ...n, contentOverride: run.output }
      }),
    }))
  }, [setState])

  /** 清空引用节点的改写，回到原始消息内容 */
  const restoreNodeContent = useCallback((nodeId: string) => {
    setState((prev) => ({
      ...prev,
      boardNodes: prev.boardNodes.map((n) => {
        if (n.id !== nodeId) return n
        const { contentOverride: _c, ...rest } = n
        return rest
      }),
    }))
  }, [setState])

  const exportMarkdown = useCallback((conv: Conversation) => {
    const md = conv.messages
      .filter((m) => m.content.trim())
      .map((m) => `### ${m.role === "user" ? "我" : "DeepSeek"}\n\n${m.content}`)
      .join("\n\n---\n\n")
    const blob = new Blob([`# ${conv.title}\n\n${md}\n`], {
      type: "text/markdown;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    /*
     * 标题里的 / \ : * ? " < > | 在 Windows/macOS 上是非法文件名，
     * 直接拿来 download 会被浏览器改写或整个保不住后缀。
     */
    a.download = `${sanitizeFilename(conv.title)}.md`
    // 必须挂到文档上，否则部分浏览器（Firefox）不会触发下载
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 立即 revoke 会让下载在部分浏览器里失败，延后释放
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  return {
    /** 由 App 注册：打开设置对话框 */
    registerOpenSettings: (fn: () => void) => {
      openSettingsRef.current = fn
    },
    state,
    projects,
    activeProject,
    projectConversations,
    visibleConversations,
    archivedConversations,
    favorites,
    tags: state.tags,
    conversationTree,
    favoriteOf,
    projectBoards,
    activeBoard,
    boardName,
    boardNodeEntries,
    boardEdges,
    boardTasks: state.boardTasks,
    projectTasks,
    activeTask,
    setMainView,
    addBoard,
    selectBoard,
    renameBoard,
    deleteBoard,
    addMessageToBoard,
    addMessageToBoardSmart,
    addMessagesToBoard,
    addExcerptToBoard,
    addConversationToBoard,
    addNote,
    moveNode,
    updateNode,
    removeNodes,
    connectNodes,
    removeEdge,
    updateEdge,
    toggleEdgeKind,
    toggleEdgeEnabled,
    addTask,
    renameTask,
    deleteTask,
    selectTask,
    toggleTaskEdge,
    runTask,
    runEdge,
    stopTask,
    applyRun,
    restoreNodeContent,
    nodeText,
    runningTaskId,
    activeConversation,
    streamingConvId,
    isStreaming: streamingConvId !== null,
    addProject,
    renameProject,
    deleteProject,
    selectProject,
    jumpToConversation,
    jumpToMessage,
    addConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    clearConversation,
    moveConversation,
    togglePin,
    toggleArchive,
    unarchiveAll,
    duplicateConversation,
    toggleFavorite,
    setFavoriteTags,
    setFavoriteNote,
    favoriteWithNote,
    removeFavorites,
    tagFavorites,
    addTag,
    renameTag,
    deleteTag,
    tagCounts,
    searchConversations,
    updateSettings,
    setNodeHue,
    setEdgeHue,
    setConversationHue,
    setSidebarView,
    send,
    stop,
    regenerate,
    branchFrom,
    exportMarkdown,
  }
}

export type ChatStore = ReturnType<typeof useChatStore>

/**
 * 把标题变成跨平台可用的文件名。
 * 保留中英文与常见符号，剔除路径分隔符和 Windows 保留字符。
 */
function sanitizeFilename(name: string): string {
  // 逐个字符过滤，避开正则里的控制字符范围
  const ILLEGAL = new Set('\\/:*?"<>|')
  const cleaned = Array.from(name)
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && !ILLEGAL.has(ch))
    .join("")
    // 末尾的点和空格在 Windows 上会被吞掉
    .replace(/[. ]+$/g, "")
    .trim()
  return cleaned || "对话"
}

/**
 * 把某条消息滚到可视区并短暂高亮。
 *
 * 调用时机在 setState 之后，此时对话视图可能还没渲染出来，
 * 因此用轮询等元素出现，而不是单次 requestAnimationFrame。
 */
function scrollMessageIntoView(messageId: string, timeout = 1500) {
  const start = Date.now()
  const tick = () => {
    const el = document.querySelector(`[data-message-id='${messageId}']`)
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      el.classList.add("msg-flash")
      setTimeout(() => el.classList.remove("msg-flash"), 1200)
      return
    }
    if (Date.now() - start < timeout) {
      requestAnimationFrame(tick)
    }
  }
  requestAnimationFrame(tick)
}

/**
 * 解析节点当前可读文本：改写优先 → 摘录 → 便签 → 源消息。
 *
 * 抽成纯函数是为了在执行循环里用「最新 state」计算，
 * 避免连续执行多条线时读到闭包里的旧内容。
 */
export function resolveNodeText(
  node: BoardNode,
  conversations: Conversation[]
): string {
  if (node.contentOverride !== undefined && node.contentOverride !== "") {
    return node.contentOverride
  }
  if (node.excerpt) return node.excerpt
  if (node.kind === "note") return node.note ?? ""
  const conv = conversations.find((c) => c.id === node.ref?.conversationId)
  const msg = conv?.messages.find((m) => m.id === node.ref?.messageId)
  return msg?.content ?? ""
}
