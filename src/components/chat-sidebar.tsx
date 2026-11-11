import { useState } from "react"
import {
  Check,
  FolderClosed,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
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
import { cn } from "@/lib/utils"

interface Props {
  store: ChatStore
  onOpenSettings: () => void
}

export function ChatSidebar({ store, onOpenSettings }: Props) {
  const {
    projects,
    activeProject,
    projectConversations,
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
  } = store

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [renaming, setRenaming] = useState<
    { kind: "project" | "conversation"; id: string; name: string } | null
  >(null)
  const [deletingProject, setDeletingProject] = useState<string | null>(null)

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

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* 头部：项目切换 */}
      <div className="flex items-center gap-1 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-9 min-w-0 flex-1 justify-start gap-2 px-2 font-medium"
              >
                <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {activeProject?.name ?? "选择项目"}
                </span>
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
                    setRenaming({ kind: "project", id: activeProject.id, name: activeProject.name })
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

      <Separator />

      {/* 会话列表 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            对话 · {projectConversations.length}
          </div>
          <div className="flex flex-col gap-0.5">
            {projectConversations.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                还没有对话
              </div>
            )}
            {projectConversations.map((c) => {
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
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.title}</span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="mr-1 size-6 shrink-0 opacity-0 group-hover/conv:opacity-100 data-[popup-open]:opacity-100"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() =>
                          setRenaming({ kind: "conversation", id: c.id, name: c.title })
                        }
                        className="gap-2"
                      >
                        <Pencil className="size-4" />
                        重命名
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
                              {p.id === c.projectId && (
                                <Check className="size-4" />
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
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
            })}
          </div>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewProjectOpen(false)}
              >
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
              <DialogTitle>重命名</DialogTitle>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenaming(null)}
              >
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
