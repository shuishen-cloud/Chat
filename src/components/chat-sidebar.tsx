import { useMemo, useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Copy,
  FolderClosed,
  FolderPlus,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  List,
  ListTree,
  Settings,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ChatStore } from "@/hooks/use-chat-store"
import type { Conversation, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  store: ChatStore
  onOpenSettings: () => void
  onOpenFavorites: () => void
}

type Renaming = { kind: "project" | "conversation"; id: string; name: string }

export function ChatSidebar({ store, onOpenSettings, onOpenFavorites }: Props) {
  const {
    projects,
    activeProject,
    visibleConversations,
    archivedConversations,
    favorites,
    activeConversation,
    addProject,
    renameProject,
    deleteProject,
    selectProject,
    addConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    moveConversation,
    togglePin,
    toggleArchive,
    unarchiveAll,
    duplicateConversation,
    state,
    setSidebarView,
    projects: allProjects,
  } = store

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [deletingProject, setDeletingProject] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const view = state.sidebarView

  /** 搜索过滤：标题 + 消息正文 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return visibleConversations
    return visibleConversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    )
  }, [visibleConversations, query])

  /** 树视图：按项目分组的全部对话（含搜索过滤） */
  const treeGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allProjects.map((proj) => {
      const convs = store.state.conversations
        .filter((c) => c.projectId === proj.id && !c.archived)
        .sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
          return b.updatedAt - a.updatedAt
        })
        .filter((c) =>
          !q
            ? true
            : c.title.toLowerCase().includes(q) ||
              c.messages.some((m) => m.content.toLowerCase().includes(q))
        )
      return { project: proj, conversations: convs }
    })
  }, [allProjects, store.state.conversations, query])

  const pinnedList = filtered.filter((c) => c.pinned)
  const normalList = filtered.filter((c) => !c.pinned)

  function submitNewProject(e: React.FormEvent) {
    e.preventDefault()
    addProject(newProjectName)
    setNewProjectName("")
    setNewProjectOpen(false)
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault()
    if (!renaming) return
    if (renaming.kind === "project") {
      renameProject(renaming.id, renaming.name)
    } else {
      renameConversation(renaming.id, renaming.name)
    }
    setRenaming(null)
  }

  function renderConversation(c: Conversation, archived = false) {
    const active = c.id === activeConversation?.id
    return (
      <div
        key={c.id}
        className={cn(
          "group/conv relative flex items-center rounded-md transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60"
        )}
      >
        <button
          type="button"
          onClick={() => selectConversation(c.id)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
        >
          {c.pinned ? (
            <Pin className="size-3.5 shrink-0 fill-current text-muted-foreground" />
          ) : c.branchedFrom ? (
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn("truncate", archived && "text-muted-foreground")}>
            {c.title}
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="mr-1 size-6 shrink-0 opacity-0 group-hover/conv:opacity-100 data-popup-open:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => togglePin(c.id)}
              className="gap-2"
            >
              {c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {c.pinned ? "取消置顶" : "置顶"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setRenaming({ kind: "conversation", id: c.id, name: c.title })}
              className="gap-2"
            >
              <Pencil className="size-4" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => duplicateConversation(c.id)}
              className="gap-2"
            >
              <Copy className="size-4" />
              创建副本
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <FolderClosed className="size-4" />
                移动到项目
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    disabled={p.id === c.projectId}
                    onClick={() => moveConversation(c.id, p.id)}
                    className="gap-2"
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.id === c.projectId && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => toggleArchive(c.id)} className="gap-2">
              {archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {archived ? "取消归档" : "归档"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => deleteConversation(c.id)}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              删除对话
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* 项目切换 */}
      <div className="flex items-center gap-1 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-9 min-w-0 flex-1 justify-start gap-2 px-2 font-medium"
              >
                <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{activeProject?.name ?? "选择项目"}</span>
              </Button>
            }
          />
          <DropdownMenuContent className="w-64" align="start">
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => selectProject(p.id)}
                className="gap-2"
              >
                <FolderClosed className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === activeProject?.id && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => setNewProjectOpen(true)} className="gap-2">
              <FolderPlus className="size-4" />
              新建项目
            </DropdownMenuItem>
            {activeProject && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    setRenaming({
                      kind: "project",
                      id: activeProject.id,
                      name: activeProject.name,
                    })
                  }
                  className="gap-2"
                >
                  <Pencil className="size-4" />
                  重命名项目
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeletingProject(activeProject.id)}
                  className="gap-2"
                >
                  <Trash2 className="size-4" />
                  删除项目
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={addConversation}
                disabled={!activeProject}
              >
                <Plus className="size-4" />
              </Button>
            }
          />
          <TooltipContent>新建对话</TooltipContent>
        </Tooltip>
      </div>

      {/* 搜索 + 视图切换 */}
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === "tree" ? "搜索全部项目" : "搜索对话与内容"}
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() =>
                  setSidebarView(view === "list" ? "tree" : "list")
                }
              >
                {view === "list" ? (
                  <ListTree className="size-4" />
                ) : (
                  <List className="size-4" />
                )}
              </Button>
            }
          />
          <TooltipContent>
            {view === "list" ? "切换到树状视图" : "切换到列表视图"}
          </TooltipContent>
        </Tooltip>
      </div>

      <Separator />

      {/* 列表区 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {/* 收藏入口 */}
          <button
            type="button"
            onClick={onOpenFavorites}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <Star className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">收藏</span>
            {favorites.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {favorites.length}
              </span>
            )}
          </button>

          <Separator className="my-1.5" />

          {view === "tree" ? (
            <TreeView
              groups={treeGroups}
              activeProjectId={activeProject?.id ?? null}
              collapsed={collapsedProjects}
              onToggleCollapse={(id) =>
                setCollapsedProjects((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              onSelectProject={selectProject}
              renderConversation={renderConversation}
            />
          ) : (
          <>
          {/* 置顶 */}
          {pinnedList.length > 0 && (
            <>
              <SectionLabel>置顶</SectionLabel>
              <div className="mb-2 flex flex-col gap-0.5">
                {pinnedList.map((c) => renderConversation(c))}
              </div>
            </>
          )}

          {/* 常规 */}
          <SectionLabel>
            对话 · {normalList.length}
            {query && " (匹配)"}
          </SectionLabel>
          <div className="flex flex-col gap-0.5">
            {normalList.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                {query ? "没有匹配的对话" : "还没有对话"}
              </div>
            )}
            {normalList.map((c) => renderConversation(c))}
          </div>

          {/* 归档 */}
          {archivedConversations.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    showArchived && "rotate-90"
                  )}
                />
                已归档 · {archivedConversations.length}
              </button>
              {showArchived && (
                <>
                  <div className="flex flex-col gap-0.5">
                    {archivedConversations.map((c) => renderConversation(c, true))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unarchiveAll(activeProject?.id ?? "")}
                    className="mt-1 h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                  >
                    <ArchiveRestore className="size-3" />
                    全部恢复
                  </Button>
                </>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </ScrollArea>

      <Separator />
      <div className="p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
          设置
        </Button>
      </div>

      {/* 新建项目 */}
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitNewProject}>
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>
                项目用于归类相关对话，例如「前端重构」「论文写作」。
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="项目名称"
              className="my-4"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewProjectOpen(false)}>
                取消
              </Button>
              <Button type="submit">创建</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitRename}>
            <DialogHeader>
              <DialogTitle>
                {renaming?.kind === "project" ? "重命名项目" : "重命名对话"}
              </DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={renaming?.name ?? ""}
              onChange={(e) =>
                setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
              }
              className="my-4"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除项目确认 */}
      <AlertDialog
        open={!!deletingProject}
        onOpenChange={(o) => !o && setDeletingProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              该项目下的所有对话都会被一并删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingProject) deleteProject(deletingProject)
                setDeletingProject(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}

/* ------------------------------------------------------------------ */

/** 树状视图：项目为父节点、对话为子节点，可折叠 */
function TreeView({
  groups,
  activeProjectId,
  collapsed,
  onToggleCollapse,
  onSelectProject,
  renderConversation,
}: {
  groups: Array<{ project: Project; conversations: Conversation[] }>
  activeProjectId: string | null
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  onSelectProject: (id: string) => void
  renderConversation: (c: Conversation, archived?: boolean) => React.ReactNode
}) {
  const visibleGroups = groups.filter((g) => g.conversations.length > 0)

  if (visibleGroups.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-xs text-muted-foreground">
        没有匹配的对话
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {visibleGroups.map(({ project, conversations }) => {
        const isCollapsed = collapsed.has(project.id)
        const isActiveProject = project.id === activeProjectId
        return (
          <div key={project.id}>
            <div
              className={cn(
                "group/proj flex items-center gap-1 rounded-md pr-1 transition-colors",
                isActiveProject ? "bg-sidebar-accent/60" : "hover:bg-sidebar-accent/40"
              )}
            >
              <button
                type="button"
                onClick={() => onToggleCollapse(project.id)}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label={isCollapsed ? "展开" : "折叠"}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    !isCollapsed && "rotate-90"
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => onSelectProject(project.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
              >
                <FolderClosed
                  className={cn(
                    "size-3.5 shrink-0",
                    isActiveProject ? "text-foreground" : "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "truncate text-xs font-medium",
                    isActiveProject ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {project.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                  {conversations.length}
                </span>
              </button>
            </div>

            {!isCollapsed && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1.5">
                {conversations.map((c) => renderConversation(c))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  )
}
