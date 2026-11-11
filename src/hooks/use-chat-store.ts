import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { streamChat } from "@/lib/deepseek"
import { loadState, nextTitle, saveState } from "@/lib/storage"
import {
  createConversation,
  createProject,
  newMessage,
  type ChatState,
  type Conversation,
  type Message,
  type Project,
} from "@/lib/types"

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

  const projectConversations = useMemo(
    () =>
      state.conversations
        .filter((c) => c.projectId === state.activeProjectId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.conversations, state.activeProjectId]
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
    updateSettings,
    send,
    stop,
    regenerate,
    exportMarkdown,
  }
}

export type ChatStore = ReturnType<typeof useChatStore>
