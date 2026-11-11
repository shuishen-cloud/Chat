import { useEffect, useMemo, useRef, useState } from "react"
import {
  Copy,
  FolderClosed,
  MessageSquare,
  Search,
  Star,
  StarOff,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { ChatStore } from "@/hooks/use-chat-store"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: ChatStore
}

/**
 * 收藏面板：紧贴侧边栏右侧滑出，非模态，不遮挡对话内容。
 */
export function FavoritesPanel({ open, onOpenChange, store }: Props) {
  const { favorites, toggleFavorite, selectConversation, selectProject } = store
  const [query, setQuery] = useState("")
  const panelRef = useRef<HTMLDivElement>(null)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    // 捕获阶段，先于其他处理器
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onOpenChange])

  // 打开时重置搜索
  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return favorites
    return favorites.filter(
      (f) =>
        f.message.content.toLowerCase().includes(q) ||
        f.conversation.title.toLowerCase().includes(q) ||
        (f.project?.name ?? "").toLowerCase().includes(q)
    )
  }, [favorites, query])

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const f of filtered) {
      const key = f.project?.name ?? "未归类"
      const arr = map.get(key) ?? []
      arr.push(f)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [filtered])

  function jumpTo(convId: string, projectId: string) {
    selectProject(projectId)
    selectConversation(convId)
    onOpenChange(false)
  }

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
      <div
        ref={panelRef}
        className={cn(
          "relative z-40 flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out",
          open ? "w-[360px]" : "w-0 border-r-0"
        )}
        aria-hidden={!open}
      >
        <div className="flex h-full w-[360px] flex-col">
          {/* 头部 */}
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-2">
              <Star className="size-4 shrink-0 fill-current text-amber-500" />
              <div className="flex-1 text-sm font-medium">收藏</div>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                {favorites.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索收藏内容"
                className="h-8 pl-7 text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* 列表 */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-16 text-center text-xs leading-relaxed text-muted-foreground">
                  {query ? (
                    "没有匹配的收藏"
                  ) : (
                    <>
                      还没有收藏
                      <br />
                      在对话中点击消息下方的「收藏」即可保存
                    </>
                  )}
                </div>
              ) : (
                grouped.map(([projectName, items]) => (
                  <div key={projectName} className="mb-3">
                    <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
                      <FolderClosed className="size-3" />
                      {projectName}
                      <span className="text-muted-foreground/60">
                        · {items.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {items.map(({ message, conversation }) => (
                        <div
                          key={`${conversation.id}:${message.id}`}
                          className="group/fav rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-ring/30 hover:bg-accent/40"
                        >
                          <div className="mb-1 flex items-center gap-1.5">
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                message.role === "user"
                                  ? "bg-secondary text-secondary-foreground"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {message.role === "user" ? "我" : "AI"}
                            </span>
                            <button
                              type="button"
                              onClick={() => jumpTo(conversation.id, conversation.projectId)}
                              className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                              title={conversation.title}
                            >
                              <MessageSquare className="size-3 shrink-0" />
                              <span className="truncate">{conversation.title}</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => jumpTo(conversation.id, conversation.projectId)}
                            className="line-clamp-3 w-full text-left text-xs leading-relaxed whitespace-pre-wrap break-words"
                          >
                            {message.content}
                          </button>

                          <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/fav:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                              onClick={() => copyText(message.content)}
                            >
                              <Copy className="size-3" />
                              复制
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                              onClick={() => toggleFavorite(conversation.id, message.id)}
                            >
                              <StarOff className="size-3" />
                              取消
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          <Separator />
          <div className="p-2 text-center text-[11px] text-muted-foreground">
            {query ? `${filtered.length} / ${favorites.length} 条` : `共 ${favorites.length} 条收藏`}
          </div>
        </div>
      </div>
    </>
  )
}
