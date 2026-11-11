import { useCallback, useMemo, useState } from "react"
import {
  ChevronDown,
  MousePointerSquareDashed,
  Play,
  Square,
  LayoutGrid,
  MessageSquare,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { BoardCanvas } from "@/components/board-canvas"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ChatStore } from "@/hooks/use-chat-store"
import { cn } from "@/lib/utils"

/**
 * 画板主视图：左侧画布，顶部是画板切换与工具条。
 * 所有数据都来自 store，画布本身不持有业务状态。
 */
export function BoardPanel({
  store,
  onClose,
}: {
  store: ChatStore
  /** 关闭画板面板（对话区始终在左侧，关掉画板即可回到全宽对话） */
  onClose: () => void
}) {
  const {
    projectBoards,
    activeBoard,
    boardNodeEntries,
    boardEdges,
    activeConversation,
    addBoard,
    selectBoard,
    renameBoard,
    deleteBoard,
    addMessageToBoard,
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
    jumpToMessage,
    projectTasks,
    activeTask,
    addTask,
    selectTask,
    toggleTaskEdge,
    runTask,
    stopTask,
    applyRun,
    restoreNodeContent,
    runningTaskId,
  } = store

  const [selected, setSelected] = useState<string[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState("")
  /** 选边模式：点线把该线加入/移出当前任务 */
  const [edgePickMode, setEdgePickMode] = useState(false)

  /**
   * 选区回调只在内容真变时更新 state。
   * 画布层已做过一次截流，这里作为第二道防线，避免新数组引发上层重渲染。
   */
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelected((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids
    )
  }, [])

  const selectedCount = selected.length

  /** 未在当前画板中的对话消息，供「从对话添加」菜单使用 */
  const conversationMessages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation]
  )

  if (!activeBoard) {
    return (
      <main className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <LayoutGrid className="size-8 text-muted-foreground" />
        <div className="text-sm font-medium">还没有画板</div>
        <p className="max-w-sm text-xs text-muted-foreground">
          画板可以把对话里的消息变成可拖拽的卡片，自由连线、写批注，用来整理思路。
        </p>
        <Button size="sm" onClick={() => addBoard()}>
          <Plus className="size-4" />
          新建画板
        </Button>
      </main>
    )
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* 工具条 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        {renaming ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              renameBoard(activeBoard.id, draftName)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameBoard(activeBoard.id, draftName)
                setRenaming(false)
              }
              if (e.key === "Escape") setRenaming(false)
            }}
            className="h-7 w-40 text-sm"
          />
        ) : (
          <button
            type="button"
            className="max-w-[200px] truncate rounded px-1.5 py-0.5 text-sm font-medium transition-colors hover:bg-muted"
            title="点击重命名"
            onClick={() => {
              setDraftName(activeBoard.name)
              setRenaming(true)
            }}
          >
            {activeBoard.name}
          </button>
        )}

        <span className="text-xs text-muted-foreground">
          {boardNodeEntries.length} 张卡片
        </span>

        <div className="flex-1" />

        {/* 画板切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <LayoutGrid className="size-3.5" />
                切换画板
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>我的画板</DropdownMenuLabel>
              {projectBoards.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  onClick={() => selectBoard(b.id)}
                  className={cn("gap-2", b.id === activeBoard.id && "bg-accent")}
                >
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.projectId === null && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">共享</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuItem onClick={() => addBoard()} className="gap-2">
              <Plus className="size-4" />
              新建画板
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          title="删除当前画板"
          onClick={() => {
            deleteBoard(activeBoard.id)
            toast.success("已删除画板")
          }}
        >
          <Trash2 className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="收起画板"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      {/* 次级工具条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        {/* 把当前对话整条加入 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!activeConversation || conversationMessages.length === 0}
          onClick={() => {
            if (!activeConversation) return
            const n = addConversationToBoard(activeConversation.id)
            toast.success(n > 0 ? `已加入 ${n} 条消息` : "这些消息都已在画板上")
          }}
        >
          <MessageSquare className="size-3" />
          当前对话全部加入
        </Button>

        {/* 单条消息加入 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={conversationMessages.length === 0}
              >
                <Plus className="size-3" />
                添加单条消息
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            {conversationMessages.map((m) => (
              <DropdownMenuItem
                key={m.id}
                className="gap-2"
                onClick={() => {
                  if (!activeConversation) return
                  const ok = addMessageToBoard(activeConversation.id, m.id)
                  toast[ok ? "success" : "info"](ok ? "已加入画板" : "该消息已在画板上")
                }}
              >
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {m.role === "user" ? "我" : "DS"}
                </span>
                <span className="truncate text-xs">
                  {m.content.replace(/\s+/g, " ").slice(0, 40) || "（空）"}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => addNote("")}
        >
          <StickyNote className="size-3" />
          新建便签
        </Button>

        <div className="flex-1" />

        {selectedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
            onClick={() => {
              removeNodes(selected)
              setSelected([])
              toast.success(`已移除 ${selectedCount} 张卡片`)
            }}
          >
            <Trash2 className="size-3" />
            移除选中 {selectedCount}
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          拖拽卡片移动 · 四边拖出连线 · 点线编辑提示词
        </span>
      </div>

      {/* 任务栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-background px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">任务</span>

        {projectTasks.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]">
                  {activeTask?.name ?? "选择任务"}
                  <ChevronDown className="size-3" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>画板任务</DropdownMenuLabel>
                {projectTasks.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => selectTask(t.id)}
                    className={cn("gap-2", t.id === activeTask?.id && "bg-accent")}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {t.edgeIds.length} 条线
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="text-[11px] text-muted-foreground">还没有任务</span>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => {
            const t = addTask()
            if (t) {
              setEdgePickMode(true)
              toast.success("已创建任务，点画布上的线把它加入任务")
            }
          }}
        >
          <Plus className="size-3" />
          新建任务
        </Button>

        {activeTask && (
          <>
            <Button
              variant={edgePickMode ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => setEdgePickMode((v) => !v)}
            >
              <MousePointerSquareDashed className="size-3" />
              {edgePickMode ? "退出选边" : "选边"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              已选 {activeTask.edgeIds.length} 条
            </span>
            <Button
              size="sm"
              className="h-7 gap-1 px-2.5 text-[11px]"
              disabled={activeTask.edgeIds.length === 0 || !!runningTaskId}
              onClick={() => runTask(activeTask.id)}
            >
              <Play className="size-3" />
              {runningTaskId ? "运行中…" : "运行任务"}
            </Button>
            {runningTaskId && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={stopTask}
              >
                <Square className="size-3" />
                停止
              </Button>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {boardNodeEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <StickyNote className="size-7 text-muted-foreground" />
            <div className="text-sm font-medium">画板还是空的</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              在对话里点消息下方的「加入画板」，或直接用上面的按钮把当前对话整条铺进来。
            </p>
            <p className="max-w-sm text-[11px] text-muted-foreground">
              也可以在左侧对话里勾选多条消息，一次性加进来。
            </p>
          </div>
        ) : (
          <BoardCanvas
            entries={boardNodeEntries}
            edges={boardEdges}
            edgeSelectMode={edgePickMode}
            selectedEdgeIds={activeTask?.edgeIds ?? []}
            onToggleTaskEdge={(edgeId) => {
              if (activeTask) toggleTaskEdge(activeTask.id, edgeId)
            }}
            onUpdateEdge={updateEdge}
            onToggleEdgeKind={toggleEdgeKind}
            onToggleEdgeEnabled={toggleEdgeEnabled}
            onSaveContent={(id, text) => updateNode(id, { contentOverride: text })}
            onRestoreContent={restoreNodeContent}
            onApplyRun={applyRun}
            onMoveNode={moveNode}
            onConnect={connectNodes}
            onRemoveNode={(id) => {
              removeNodes([id])
              setSelected((prev) => prev.filter((x) => x !== id))
            }}
            onRemoveEdge={removeEdge}
            onToggleExpand={(id) => {
              const node = boardNodeEntries.find((e) => e.node.id === id)?.node
              if (node) updateNode(id, { expanded: !node.expanded })
            }}
            onJump={jumpToMessage}
            onEditNote={(id, text) => updateNode(id, { note: text })}
            onResizeNode={(id, width, height) => updateNode(id, { width, height })}
            onSelectionChange={handleSelectionChange}
          />
        )}
      </div>
    </main>
  )
}
