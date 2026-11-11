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

const STORAGE_KEY = "shadcn-chat/prompt-history/v1"
const MAX_ITEMS = 200

function load(): PromptHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function save(items: PromptHistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {
    /* 忽略 */
  }
}

/**
 * 提示词历史：记录用过的提问，支持搜索、复制、复用、删除。
 * 存储独立于 ChatState，避免污染主状态。
 */
export function usePromptHistory() {
  const [items, setItems] = useState<PromptHistoryItem[]>(() => load())
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => save(items), 300)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [items])

  /** 记录一次提问（相同文本则置顶刷新） */
  const record = useCallback(
    (text: string, source: PromptHistoryItem["source"] = "chat") => {
      const trimmed = text.trim()
      if (!trimmed || trimmed.length > 2000) return
      setItems((prev) => {
        const rest = prev.filter((i) => i.text !== trimmed)
        return [
          { id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text: trimmed, usedAt: Date.now(), source },
          ...rest,
        ].slice(0, MAX_ITEMS)
      })
    },
    []
  )

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  return { items, record, remove, clear }
}

export type PromptHistoryApi = ReturnType<typeof usePromptHistory>

interface PanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: PromptHistoryApi
  /** 点击历史项时填入输入框 */
  onPick: (text: string) => void
}

/**
 * 右侧悬浮的提示词历史：收起时是一个贴边按钮，展开为侧栏。
 */
export function PromptHistoryPanel({ open, onOpenChange, history, onPick }: PanelProps) {
  const [query, setQuery] = useState("")
  const { items, remove, clear } = history

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
          title="提示词历史"
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
          <div className="flex-1 text-sm font-medium">提示词历史</div>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title="清空历史"
            onClick={() => {
              clear()
              toast.success("已清空历史")
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
              <div className="px-3 py-12 text-center text-xs leading-relaxed text-muted-foreground">
                {items.length === 0
                  ? "还没有历史记录\n发出的提问会自动记在这里"
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
                        onClick={() => remove(item.id)}
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
