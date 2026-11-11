import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Clock, Copy, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export interface PromptHistoryItem {
  id: string
  text: string
  /** 使用时间 */
  usedAt: number
  /** 来源：主对话 / 浮窗追问 */
  source: "chat" | "quickask"
}

/** 按对话分组的历史：conversationId -> 该对话的提问列表 */
type HistoryMap = Record<string, PromptHistoryItem[]>

const STORAGE_KEY = "shadcn-chat/prompt-history/v2"
/** 旧版全局历史键，改为按对话隔离后不再使用，启动时清理 */
const LEGACY_KEY = "shadcn-chat/prompt-history/v1"
const MAX_PER_CONVERSATION = 100

function load(): HistoryMap {
  try {
    // 清理旧版全局历史（无法可靠映射到具体对话）
    localStorage.removeItem(LEGACY_KEY)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}
    const out: HistoryMap = {}
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) out[k] = v.filter((i) => i && typeof i.text === "string")
    }
    return out
  } catch {
    return {}
  }
}

function save(map: HistoryMap) {
  try {
    const trimmed: HistoryMap = {}
    for (const [k, v] of Object.entries(map)) {
      if (v.length) trimmed[k] = v.slice(0, MAX_PER_CONVERSATION)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* 忽略 */
  }
}

/**
 * 提示词历史：按对话隔离，每个对话维护自己的提问记录。
 * 存储独立于 ChatState，避免污染主状态。
 */
export function usePromptHistory() {
  const [map, setMap] = useState<HistoryMap>(() => load())
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => save(map), 300)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [map])

  /** 记录一次提问到指定对话（相同文本置顶刷新） */
  const record = useCallback(
    (
      conversationId: string | null,
      text: string,
      source: PromptHistoryItem["source"] = "chat"
    ) => {
      const trimmed = text.trim()
      if (!conversationId || !trimmed || trimmed.length > 2000) return
      setMap((prev) => {
        const list = prev[conversationId] ?? []
        const rest = list.filter((i) => i.text !== trimmed)
        return {
          ...prev,
          [conversationId]: [
            {
              id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              text: trimmed,
              usedAt: Date.now(),
              source,
            },
            ...rest,
          ].slice(0, MAX_PER_CONVERSATION),
        }
      })
    },
    []
  )

  const remove = useCallback((conversationId: string, id: string) => {
    setMap((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).filter((i) => i.id !== id),
    }))
  }, [])

  const clear = useCallback((conversationId: string) => {
    setMap((prev) => ({ ...prev, [conversationId]: [] }))
  }, [])

  /** 某个对话的历史 */
  const getItems = useCallback(
    (conversationId: string | null) =>
      conversationId ? (map[conversationId] ?? []) : [],
    [map]
  )

  /** 全部对话的历史条数合计 */
  const totalCount = useMemo(
    () => Object.values(map).reduce((n, v) => n + v.length, 0),
    [map]
  )

  return { map, record, remove, clear, getItems, totalCount }
}

export type PromptHistoryApi = ReturnType<typeof usePromptHistory>

interface PanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: PromptHistoryApi
  /** 当前对话 id，历史按对话隔离 */
  conversationId: string | null
  /** 当前对话标题，用于面板副标题 */
  conversationTitle: string | null
  /** 点击历史项时填入输入框 */
  onPick: (text: string) => void
}

/**
 * 右侧悬浮的提示词历史：收起时是一个贴边按钮，展开为侧栏。
 */
export function PromptHistoryPanel({
  open,
  onOpenChange,
  history,
  conversationId,
  conversationTitle,
  onPick,
}: PanelProps) {
  const [query, setQuery] = useState("")
  const { remove, clear, getItems } = history
  const items = getItems(conversationId)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.text.toLowerCase().includes(q))
  }, [items, query])

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  return (
    <>
      {/* 贴边悬浮按钮 */}
      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          title={conversationTitle ? `「${conversationTitle}」的提示词历史` : "提示词历史"}
          className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 items-center gap-1 rounded-l-lg border border-r-0 border-border bg-popover py-2 pr-1 pl-1.5 text-[11px] text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          <Clock className="size-3.5" />
          {items.length > 0 && (
            <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums">
              {items.length}
            </span>
          )}
        </button>
      )}

      {/* 展开面板 */}
      <div
        data-aux-panel="prompt-history"
        className={cn(
          "fixed top-0 right-0 z-40 flex h-full flex-col overflow-hidden border-l border-border bg-sidebar shadow-lg transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
        style={{ width: 320 }}
        aria-hidden={!open}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">提示词历史</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {conversationTitle ?? "未选择对话"}
            </div>
          </div>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title="清空本对话历史"
            disabled={!conversationId || items.length === 0}
            onClick={() => {
              if (!conversationId) return
              clear(conversationId)
              toast.success("已清空本对话历史")
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="shrink-0 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索历史提示词"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-12 text-center text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                {!conversationId
                  ? "请先选择一个对话"
                  : items.length === 0
                    ? "本对话还没有历史记录\n发出的提问会自动记在这里"
                    : "没有匹配的提示词"}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.map((item) => (
                  <div
                    key={item.id}
                    className="group/ph rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onPick(item.text)
                        onOpenChange(false)
                        toast.success("已填入输入框")
                      }}
                      className="line-clamp-3 w-full text-left text-xs leading-relaxed break-words"
                      title={item.text}
                    >
                      {item.text}
                    </button>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1 py-0.5">
                        {item.source === "quickask" ? "浮窗" : "对话"}
                      </span>
                      <span>{relativeTime(item.usedAt)}</span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => copyText(item.text)}
                        className="opacity-0 transition-opacity group-hover/ph:opacity-100 hover:text-foreground"
                        title="复制"
                      >
                        <Copy className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => conversationId && remove(conversationId, item.id)}
                        className="opacity-0 transition-opacity group-hover/ph:opacity-100 hover:text-destructive"
                        title="删除"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(ts)
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}
