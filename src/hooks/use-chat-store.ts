import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { streamChat } from "@/lib/deepseek"
import { loadState, nextTitle, saveState } from "@/lib/storage"
import {
  TAG_HUES,
  createConversation,
  createFavorite,
  createProject,
  newMessage,
  uid,
  type ChatState,
  type Conversation,
  type Favorite,
  type Message,
  type Project,
  type Tag,
} from "@/lib/types"

/** 分支树节点：一个对话及其分支后代 */
export interface BranchNode {
  conversation: Conversation
  children: BranchNode[]
  /** 树深度，0 为根对话 */
  depth: number
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
  const [state, setState] = useState<ChatState>(() => loadState())
  const abortRef = useRef<AbortController | null>(null)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)

  // 持久化（防抖）
  useEffect(() => {
    const t = setTimeout(() => saveState(state), 200)
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
  }, [])

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
  }, [])

  const renameProject = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === id ? { ...p, name: name.trim() || p.name } : p
      ),
    }))
  }, [])

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
      return {
        ...prev,
        projects,
        conversations,
        activeProjectId,
        activeConversationId,
      }
    })
  }, [])

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
  }, [])

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
  }, [])

  const selectConversation = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeConversationId: id }))
  }, [])

  const renameConversation = useCallback((id: string, title: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, title: title.trim() || c.title } : c
      ),
    }))
  }, [])

  const deleteConversation = useCallback((id: string) => {
    setState((prev) => {
      const conversations = prev.conversations.filter((c) => c.id !== id)
      const activeConversationId =
        prev.activeConversationId === id
          ? (conversations
              .filter((c) => c.projectId === prev.activeProjectId)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
          : prev.activeConversationId
      return { ...prev, conversations, activeConversationId }
    })
  }, [])

  const clearConversation = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id
          ? { ...c, messages: [], title: "新对话", updatedAt: Date.now() }
          : c
      ),
    }))
  }, [])

  const moveConversation = useCallback((convId: string, projectId: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === convId ? { ...c, projectId, updatedAt: Date.now() } : c
      ),
    }))
  }, [])

  const togglePin = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, pinned: !c.pinned } : c
      ),
    }))
  }, [])

  const toggleArchive = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, archived: !c.archived } : c
      ),
    }))
  }, [])

  /** 将全部已归档对话恢复 */
  const unarchiveAll = useCallback((projectId: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.projectId === projectId && c.archived ? { ...c, archived: false } : c
      ),
    }))
  }, [])

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
  }, [])

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
  }, [])

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
    []
  )

  /** 设置收藏备注 */
  const setFavoriteNote = useCallback((favoriteId: string, note: string) => {
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.map((f) =>
        f.id === favoriteId ? { ...f, note } : f
      ),
    }))
  }, [])

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
    []
  )

  /** 批量取消收藏 */
  const removeFavorites = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setState((prev) => ({
      ...prev,
      favorites: prev.favorites.filter((f) => !set.has(f.id)),
    }))
  }, [])

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
  }, [])

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
  }, [])

  const renameTag = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setState((prev) => ({
      ...prev,
      tags: prev.tags.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    }))
  }, [])

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
  }, [])

  /** 标签使用计数 */
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of state.favorites) {
      for (const t of f.tagIds) map.set(t, (map.get(t) ?? 0) + 1)
    }
    return map
  }, [state.favorites])

  const setSidebarView = useCallback((view: ChatState["sidebarView"]) => {
    setState((prev) => ({ ...prev, sidebarView: view }))
  }, [])

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
    (patch: Partial<Pick<ChatState, "apiKey" | "baseUrl" | "model">>) => {
      setState((prev) => ({ ...prev, ...patch }))
    },
    []
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
    []
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || streamingConvId) return

      // 1) 先确定目标会话 id（可能需新建），再一次性写入用户消息 + 占位回复
      let convId: string | null = null
      let history: Message[] = []

      setState((prev) => {
        let conversations = prev.conversations
        let targetId = prev.activeConversationId

        if (!targetId) {
          if (!prev.activeProjectId) return prev
          const created = createConversation(prev.activeProjectId)
          conversations = [...conversations, created]
          targetId = created.id
        }

        const target = conversations.find((c) => c.id === targetId)!
        convId = target.id
        history = target.messages

        const userMsg = newMessage("user", content)
        const reply = { ...newMessage("assistant", ""), streaming: true }

        return {
          ...prev,
          conversations: conversations.map((c) =>
            c.id === targetId
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

      if (!convId) return
      const targetConvId: string = convId

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
          toast.error(message, { duration: 6000 })
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
      streamingConvId,
      updateMessages,
    ]
  )

  const regenerate = useCallback(
    async (conv: Conversation) => {
      if (streamingConvId) return
      const lastUser = [...conv.messages].reverse().find((m) => m.role === "user")
      if (!lastUser) return

      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== conv.id) return c
          const trimmed = c.messages.slice()
          while (trimmed.length && trimmed[trimmed.length - 1].role === "assistant") {
            trimmed.pop()
          }
          // 去掉最后一条 user（send 会重新追加）
          if (trimmed.length && trimmed[trimmed.length - 1].id === lastUser.id) {
            trimmed.pop()
          }
          return { ...c, messages: trimmed, updatedAt: Date.now() }
        }),
      }))
      await send(lastUser.content)
    },
    [send, streamingConvId]
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
    []
  )

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
    a.download = `${conv.title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return {
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
    activeConversation,
    streamingConvId,
    isStreaming: streamingConvId !== null,
    addProject,
    renameProject,
    deleteProject,
    selectProject,
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
    setSidebarView,
    send,
    stop,
    regenerate,
    branchFrom,
    exportMarkdown,
  }
}

export type ChatStore = ReturnType<typeof useChatStore>
