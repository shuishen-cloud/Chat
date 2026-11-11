import { useEffect, useMemo, useState } from "react"
import {
  ArrowDownWideNarrow,
  Check,
  Copy,
  FolderClosed,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Star,
  StarOff,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ChatStore } from "@/hooks/use-chat-store"
import type { Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: ChatStore
}

type SortKey = "recent" | "oldest" | "conversation"
type GroupKey = "project" | "tag" | "none"

export function FavoritesPanel({ open, onOpenChange, store }: Props) {
  const {
    favorites,
    tags,
    tagCounts,
    toggleFavorite,
    setFavoriteTags,
    removeFavorites,
    tagFavorites,
    addTag,
    renameTag,
    deleteTag,
    selectConversation,
    selectProject,
  } = store

  const [query, setQuery] = useState("")
  const [activeTagIds, setActiveTagIds] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>("recent")
  const [group, setGroup] = useState<GroupKey>("project")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [newTagName, setNewTagName] = useState("")
  const [addingTag, setAddingTag] = useState(false)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveTagIds([])
      setSelected(new Set())
    }
  }, [open])

  /** 筛选 → 排序 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = favorites

    if (q) {
      list = list.filter(
        (f) =>
          f.message.content.toLowerCase().includes(q) ||
          f.conversation.title.toLowerCase().includes(q) ||
          (f.project?.name ?? "").toLowerCase().includes(q) ||
          (f.favorite.note ?? "").toLowerCase().includes(q) ||
          f.tags.some((t) => t.name.toLowerCase().includes(q))
      )
    }

    // 多标签取交集（AND）
    if (activeTagIds.length) {
      list = list.filter((f) =>
        activeTagIds.every((id) => f.favorite.tagIds.includes(id))
      )
    }

    const sorted = [...list]
    if (sort === "recent") {
      sorted.sort((a, b) => b.favorite.createdAt - a.favorite.createdAt)
    } else if (sort === "oldest") {
      sorted.sort((a, b) => a.favorite.createdAt - b.favorite.createdAt)
    } else {
      sorted.sort(
        (a, b) =>
          a.conversation.title.localeCompare(b.conversation.title) ||
          b.favorite.createdAt - a.favorite.createdAt
      )
    }
    return sorted
  }, [favorites, query, activeTagIds, sort])

  /** 分组 */
  const grouped = useMemo(() => {
    if (group === "none") return [["全部", filtered] as const]

    const map = new Map<string, typeof filtered>()
    for (const f of filtered) {
      let key: string
      if (group === "project") {
        key = f.project?.name ?? "未归类"
      } else {
        if (f.tags.length === 0) key = "未打标签"
        else key = f.tags.map((t) => t.name).join(" · ")
      }
      const arr = map.get(key) ?? []
      arr.push(f)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [filtered, group])

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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((f) => f.favorite.id)))
  }

  function submitNewTag(e: React.FormEvent) {
    e.preventDefault()
    const id = addTag(newTagName)
    if (id) {
      setNewTagName("")
      setAddingTag(false)
    }
  }

  return (
    <div
      className={cn(
        "relative z-40 flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out",
        open ? "w-[380px]" : "w-0 border-r-0"
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[380px] flex-col">
        {/* 头部 */}
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Star className="size-4 shrink-0 fill-current text-amber-500" />
            <div className="flex-1 text-sm font-medium">收藏</div>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              {filtered.length}
              {filtered.length !== favorites.length && `/${favorites.length}`}
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

          {/* 搜索 */}
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索收藏内容、备注、标签"
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

          {/* 标签筛选栏 */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {tags.map((t) => {
              const on = activeTagIds.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setActiveTagIds((prev) =>
                      on ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                    )
                  }
                  className={cn(
                    "group/tag inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                    on
                      ? "border-transparent font-medium"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                  style={
                    on
                      ? { background: `hsl(${t.hue} 85% 92%)`, color: `hsl(${t.hue} 60% 25%)` }
                      : undefined
                  }
                >
                  {t.name}
                  <span className="opacity-60">{tagCounts.get(t.id) ?? 0}</span>
                </button>
              )
            })}

            {addingTag ? (
              <form onSubmit={submitNewTag} className="inline-flex">
                <Input
                  autoFocus
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onBlur={() => !newTagName && setAddingTag(false)}
                  placeholder="标签名"
                  className="h-5 w-20 px-1.5 text-[10px]"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTag(true)}
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-2.5" />
                标签
              </button>
            )}

            {activeTagIds.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTagIds([])}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {/* 工具栏：排序 / 分组 / 全选 */}
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={selectAll}
          >
            {selected.size === filtered.length && filtered.length > 0 ? (
              <Check className="size-3" />
            ) : (
              <span className="size-3 rounded-[3px] border border-current" />
            )}
            全选
          </Button>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                >
                  <ArrowDownWideNarrow className="size-3" />
                  {sort === "recent" ? "最新" : sort === "oldest" ? "最早" : "按对话"}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>排序</DropdownMenuLabel>
              {(
                [
                  ["recent", "收藏时间（新→旧）"],
                  ["oldest", "收藏时间（旧→新）"],
                  ["conversation", "按对话名"],
                ] as const
              ).map(([k, label]) => (
                <DropdownMenuItem key={k} onClick={() => setSort(k)} className="gap-2">
                  <span className="flex-1">{label}</span>
                  {sort === k && <Check className="size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                >
                  {group === "project" ? "按项目" : group === "tag" ? "按标签" : "不分组"}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuLabel>分组</DropdownMenuLabel>
              {(
                [
                  ["project", "按项目"],
                  ["tag", "按标签"],
                  ["none", "不分组"],
                ] as const
              ).map(([k, label]) => (
                <DropdownMenuItem key={k} onClick={() => setGroup(k)} className="gap-2">
                  <span className="flex-1">{label}</span>
                  {group === k && <Check className="size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 批量操作条 */}
        {selected.size > 0 && (
          <div className="flex items-center gap-1 border-b border-border bg-muted/50 px-2 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              已选 {selected.size}
            </span>
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  >
                    <TagIcon className="size-3" />
                    打标签
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                {tags.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    还没有标签
                  </div>
                )}
                {tags.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => {
                      tagFavorites([...selected], t.id)
                      toast.success(`已添加到「${t.name}」`)
                    }}
                    className="gap-2"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: `hsl(${t.hue} 70% 55%)` }}
                    />
                    {t.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => toast.info("在标签栏点「+ 标签」新建")}
                  className="gap-2 text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                  新建标签
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-destructive hover:text-destructive"
              onClick={() => {
                removeFavorites([...selected])
                setSelected(new Set())
                toast.success("已取消收藏")
              }}
            >
              <Trash2 className="size-3" />
              取消收藏
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              清除
            </Button>
          </div>
        )}

        {/* 列表 */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-16 text-center text-xs leading-relaxed text-muted-foreground">
                {favorites.length === 0 ? (
                  <>
                    还没有收藏
                    <br />
                    在对话中点击消息下方的「收藏」即可保存
                  </>
                ) : (
                  "没有符合筛选条件的收藏"
                )}
              </div>
            ) : (
              grouped.map(([groupName, items]) => (
                <div key={groupName} className="mb-3">
                  <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {group === "project" ? (
                      <FolderClosed className="size-3" />
                    ) : group === "tag" ? (
                      <TagIcon className="size-3" />
                    ) : null}
                    {groupName}
                    <span className="text-muted-foreground/60">· {items.length}</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {items.map(({ favorite, message, conversation, tags: itemTags }) => {
                      const isSel = selected.has(favorite.id)
                      return (
                        <div
                          key={favorite.id}
                          className={cn(
                            "group/fav rounded-lg border bg-card p-2.5 transition-colors",
                            isSel
                              ? "border-ring/60 bg-accent/50"
                              : "border-border hover:border-ring/30 hover:bg-accent/40"
                          )}
                        >
                          <div className="mb-1 flex items-center gap-1.5">
                            <Checkbox
                              checked={isSel}
                              onCheckedChange={() => toggleSelect(favorite.id)}
                              className="size-3.5 shrink-0"
                            />
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
                              onClick={() =>
                                jumpTo(conversation.id, conversation.projectId)
                              }
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

                          {favorite.note && (
                            <div className="mt-1 rounded bg-muted/60 px-1.5 py-1 text-[11px] text-muted-foreground">
                              {favorite.note}
                            </div>
                          )}

                          {itemTags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {itemTags.map((t) => (
                                <span
                                  key={t.id}
                                  className="rounded-full px-1.5 py-0.5 text-[10px]"
                                  style={{
                                    background: `hsl(${t.hue} 85% 92%)`,
                                    color: `hsl(${t.hue} 60% 25%)`,
                                  }}
                                >
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}

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

                            {/* 标签管理 */}
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                                  >
                                    <TagIcon className="size-3" />
                                    标签
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="start" className="w-44">
                                {tags.length === 0 && (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    还没有标签
                                  </div>
                                )}
                                {tags.map((t) => (
                                  <DropdownMenuCheckboxItem
                                    key={t.id}
                                    checked={favorite.tagIds.includes(t.id)}
                                    onCheckedChange={(v) => {
                                      const next = v
                                        ? [...favorite.tagIds, t.id]
                                        : favorite.tagIds.filter((x) => x !== t.id)
                                      setFavoriteTags(favorite.id, next)
                                    }}
                                  >
                                    <span
                                      className="mr-1.5 size-2.5 rounded-full"
                                      style={{ background: `hsl(${t.hue} 70% 55%)` }}
                                    />
                                    {t.name}
                                  </DropdownMenuCheckboxItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <div className="flex-1" />
                            <span className="text-[10px] text-muted-foreground">
                              {formatDate(favorite.createdAt)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* 标签管理底栏 */}
        {tags.length > 0 && (
          <>
            <Separator />
            <TagManager
              tags={tags}
              counts={tagCounts}
              onRename={renameTag}
              onDelete={deleteTag}
            />
          </>
        )}

        <Separator />
        <div className="p-2 text-center text-[11px] text-muted-foreground">
          {filtered.length === favorites.length
            ? `共 ${favorites.length} 条收藏`
            : `${filtered.length} / ${favorites.length} 条`}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 今天/昨天显示相对时间，更早显示日期 */
function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return ""
  if (same(d, now)) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  if (same(d, yest)) return "昨天"
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

function TagManager({
  tags,
  counts,
  onRename,
  onDelete,
}: {
  tags: Tag[]
  counts: Map<string, number>
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="max-h-32 overflow-y-auto p-2">
      <div className="mb-1 flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
        <TagIcon className="size-3" />
        标签管理
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onRename(editing.id, editing.name)
            setEditing(null)
          }}
          className="px-1"
        >
          <Input
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onBlur={() => setEditing(null)}
            className="h-6 text-[11px]"
          />
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t.id}
              className="group/tm inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
              style={{
                background: `hsl(${t.hue} 85% 92%)`,
                color: `hsl(${t.hue} 60% 25%)`,
              }}
            >
              {t.name}
              <span className="opacity-50">{counts.get(t.id) ?? 0}</span>
              <button
                type="button"
                onClick={() => setEditing({ id: t.id, name: t.name })}
                className="opacity-0 transition-opacity group-hover/tm:opacity-60 hover:!opacity-100"
                title="重命名"
              >
                <Pencil className="size-2.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(t.id)}
                className="opacity-0 transition-opacity group-hover/tm:opacity-60 hover:!opacity-100"
                title="删除标签"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
