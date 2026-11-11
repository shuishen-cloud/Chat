import { useMemo, useState } from "react"
import { Copy, FolderClosed, MessageSquare, Search, Star, StarOff, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ChatStore } from "@/hooks/use-chat-store"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: ChatStore
}

export function FavoritesPanel({ open, onOpenChange, store }: Props) {
  const { favorites, toggleFavorite, selectConversation, selectProject } = store
  const [query, setQuery] = useState("")

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

  // 按项目分组
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex items-center gap-2">
            <Star className="size-4 fill-current text-amber-500" />
            收藏 · {favorites.length}
          </SheetTitle>
          <SheetDescription>
            跨项目汇总所有已收藏的消息，点击可跳回原对话。
          </SheetDescription>
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
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {query ? "没有匹配的收藏" : "还没有收藏\n在消息上点「收藏」即可保存"}
              </div>
            ) : (
              grouped.map(([projectName, items]) => (
                <div key={projectName} className="mb-4">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                    <FolderClosed className="size-3" />
                    {projectName}
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map(({ message, conversation }) => (
                      <div
                        key={`${conversation.id}:${message.id}`}
                        className="group/fav rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40"
                      >
                        <div className="mb-1.5 flex items-start gap-1.5">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {message.role === "user" ? "我" : "DeepSeek"}
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpTo(conversation.id, conversation.projectId)}
                            className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <MessageSquare className="size-3 shrink-0" />
                            <span className="truncate">{conversation.title}</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => jumpTo(conversation.id, conversation.projectId)}
                          className="line-clamp-4 w-full text-left text-sm whitespace-pre-wrap break-words"
                        >
                          {message.content}
                        </button>

                        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/fav:opacity-100">
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
                            onClick={() =>
                              toggleFavorite(conversation.id, message.id)
                            }
                          >
                            <StarOff className="size-3" />
                            取消收藏
                          </Button>
                          <div className="flex-1" />
                          <span className="text-[10px] text-muted-foreground">
                            {message.favoritedAt
                              ? new Date(message.favoritedAt).toLocaleDateString()
                              : ""}
                          </span>
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
        <div className="p-3 text-center text-[11px] text-muted-foreground">
          共 {filtered.length} 条收藏
        </div>
      </SheetContent>
    </Sheet>
  )
}
