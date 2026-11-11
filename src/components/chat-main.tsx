import { useEffect, useMemo, useRef, useState } from "react"
import {
  Search,
  Plus,
  Pin,
  MessageSquare,
  ChevronDown,
  Check,
  AlertCircle,
  ArrowUp,
  Brain,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  GitBranch,
  RefreshCw,
  Sparkles,
  Square,
  Star,
  Trash2,
  LayoutGrid,
  ListChecks,
  SquareCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Markdown, TypingCursor } from "@/components/markdown"
import { BoardPickerMenu } from "@/components/board-picker-menu"
import { useSelectionWatcher, useStickToBottom } from "@/hooks/use-scroll"
import { QuickAskLayer } from "@/components/quick-ask-layer"
import type { ChatStore } from "@/hooks/use-chat-store"
import type { Conversation, Message } from "@/lib/types"
import { MODELS } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MoreHorizontal } from "lucide-react"

interface Props {
  store: ChatStore
  onOpenSettings: () => void
  history: import("@/components/prompt-history").PromptHistoryApi
  /** 由历史面板填入的草稿，消费后通过 onDraftConsumed 清空 */
  draft: string
  onDraftConsumed: () => void
}

export function ChatMain({ store, onOpenSettings, history, draft, onDraftConsumed }: Props) {
  const {
    activeConversation,
    activeProject,
    isStreaming,
    state,
    send,
    stop,
    regenerate,
    branchFrom,
    toggleFavorite,
    favoriteOf,
    addMessageToBoardSmart,
    addMessagesToBoard,
    projectBoards,
    boardName,
    clearConversation,
    deleteConversation,
    exportMarkdown,
    selectConversation,
    addBoard,
  } = store

  const messages = activeConversation?.messages ?? []
  const lastContent = messages[messages.length - 1]?.content ?? ""
  const { ref: scrollRef } = useStickToBottom(
    `${activeConversation?.id ?? ""}:${messages.length}:${lastContent.length}`
  )

  /**
   * 勾选模式：一次挑多条消息放进指定画板。
   * 单条「加入画板」适合随手收藏，多选才适合「把这几段结论整理成一张图」。
   */
  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  /** 批量加入的目标画板，默认当前激活画板 */
  const [targetBoardId, setTargetBoardId] = useState<string | null>(
    store.state.activeBoardId
  )

  // 选区追问
  const { selection, clear: clearSelection } = useSelectionWatcher(
    scrollRef,
    // 多选时点击消息用于勾选，划词浮层会抢交互，先关掉
    !!activeConversation && !isStreaming && !selectMode
  )

  const exitSelectMode = () => {
    setSelectMode(false)
    setCheckedIds(new Set())
  }

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 批量加入选中的消息到目标画板 */
  function addCheckedToBoard() {
    if (!activeConversation || checkedIds.size === 0) return
    let boardId = targetBoardId
    if (!boardId) {
      const board = addBoard()
      boardId = board.id
    }
    const { added, skipped } = addMessagesToBoard(
      activeConversation.id,
      [...checkedIds],
      boardId
    )
    const targetName = boardName(boardId)
    if (added === 0) {
      toast.info(`选中的消息都已在「${targetName}」里`)
    } else {
      toast.success(
        skipped > 0
          ? `已加入 ${added} 条到「${targetName}」，${skipped} 条已存在`
          : `已加入 ${added} 条到「${targetName}」`
      )
    }
    exitSelectMode()
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <ConversationSwitcher store={store} />
          <div className="truncate text-xs text-muted-foreground">
            {activeProject?.name ?? "未选择项目"} · {state.model}
          </div>
        </div>

        {activeConversation && messages.length > 0 && (
          <Button
            variant={selectMode ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            title="勾选多条消息，批量加入画板"
          >
            <ListChecks className="size-3.5" />
            {selectMode ? "退出多选" : "多选"}
          </Button>
        )}

        {activeConversation && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => exportMarkdown(activeConversation)}
                className="gap-2"
              >
                <Download className="size-4" />
                导出为 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  clearConversation(activeConversation.id)
                  toast.success("已清空对话")
                }}
                className="gap-2"
              >
                <Eraser className="size-4" />
                清空消息
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  deleteConversation(activeConversation.id)
                  toast.success("已删除对话")
                }}
                className="gap-2"
              >
                <Trash2 className="size-4" />
                删除对话
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* 多选操作栏 */}
      {selectMode && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            已选 <span className="font-medium text-foreground">{checkedIds.size}</span> 条
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() =>
              setCheckedIds(
                checkedIds.size === messages.length
                  ? new Set()
                  : new Set(messages.map((m) => m.id))
              )
            }
          >
            {checkedIds.size === messages.length ? "取消全选" : "全选"}
          </Button>

          <BoardPickerMenu
            boards={projectBoards}
            selectedId={targetBoardId}
            title="加入哪个画板"
            label={boardName(targetBoardId, "新建画板")}
            variant="outline"
            triggerClassName="h-7"
            onPick={setTargetBoardId}
            onCreate={() => setTargetBoardId(null)}
          />

          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7 gap-1 px-3 text-[11px]"
            disabled={checkedIds.size === 0}
            onClick={addCheckedToBoard}
          >
            <LayoutGrid className="size-3" />
            加入选中 {checkedIds.size > 0 ? `(${checkedIds.size})` : ""}
          </Button>
        </div>
      )}

      {/* 消息区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {activeConversation?.branchedFrom && (
            <BranchBanner
              from={activeConversation.branchedFrom}
              onJump={() =>
                selectConversation(activeConversation.branchedFrom!.conversationId)
              }
            />
          )}
          {messages.length === 0 ? (
            <EmptyState onPick={(t) => send(t)} />
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  canRegenerate={!isStreaming}
                  onRegenerate={() =>
                    activeConversation && regenerate(activeConversation, m.id)
                  }
                  onBranch={() => {
                    if (!activeConversation) return
                    branchFrom(activeConversation.id, m.id)
                    toast.success("已创建分支对话")
                  }}
                  favorited={
                    !!activeConversation &&
                    !!favoriteOf(activeConversation.id, m.id)
                  }
                  onToggleFavorite={() => {
                    if (!activeConversation) return
                    toggleFavorite(activeConversation.id, m.id)
                  }}
                  selectMode={selectMode}
                  checked={checkedIds.has(m.id)}
                  onToggleCheck={() => toggleCheck(m.id)}
                  onAddToBoard={() => {
                    if (!activeConversation) return
                    addMessageToBoardSmart(activeConversation.id, m.id)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border bg-background/80 p-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            isStreaming={isStreaming}
            model={state.model}
            onSend={send}
            onStop={stop}
            onOpenSettings={onOpenSettings}
            draft={draft}
            onDraftConsumed={onDraftConsumed}
            activeConversationId={activeConversation?.id ?? null}
            history={history}
          />
          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            内容由 AI 生成，请自行甄别 · 仅支持 DeepSeek
          </div>
        </div>
      </div>

      <QuickAskLayer
        history={history}
        selection={
          selection && activeConversation
            ? { ...selection, conversationId: activeConversation.id }
            : null
        }
        clearSelection={clearSelection}
        conversationId={activeConversation?.id ?? null}
        store={store}
      />
    </main>
  )
}

/* ------------------------------------------------------------------ */

function BranchBanner({
  from,
  onJump,
}: {
  from: { conversationTitle: string; conversationId: string }
  onJump: () => void
}) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        分支自「{from.conversationTitle}」
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={onJump}
      >
        回到原对话
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const samples = [
    "用 TypeScript 写一个带重试的 fetch 封装",
    "解释一下 React Server Components 的边界",
    "帮我把这段 SQL 优化成窗口函数写法",
    "给一个 shadcn/ui 三栏布局的最小示例",
  ]
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted">
        <Sparkles className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">开始新的对话</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        选择左侧项目来归类你的对话，或直接提问
      </p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {samples.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 勾选态小图标，用于多选模式下标识消息是否被选中 */
function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span className={cn("shrink-0 text-primary", className)} aria-hidden>
      {checked ? (
        <SquareCheck className="size-4" />
      ) : (
        <Square className="size-4 text-muted-foreground" />
      )}
    </span>
  )
}

function MessageBubble({
  message,
  isLast,
  canRegenerate,
  onRegenerate,
  onBranch,
  favorited,
  onToggleFavorite,
  onAddToBoard,
  selectMode,
  checked,
  onToggleCheck,
}: {
  message: Message
  isLast: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  onBranch: () => void
  favorited: boolean
  onToggleFavorite: () => void
  onAddToBoard: () => void
  /** 勾选模式：点击整条消息切换选中 */
  selectMode: boolean
  checked: boolean
  onToggleCheck: () => void
}) {
  const isUser = message.role === "user"

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content)
      toast.success("已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  if (isUser) {
    return (
      <div
        className={cn(
          "group/msg flex flex-col items-end",
          selectMode && "cursor-pointer rounded-xl px-2 py-1.5 transition-colors",
          selectMode && (checked ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/60")
        )}
        data-message-id={message.id}
        onClick={selectMode ? onToggleCheck : undefined}
      >
        <div className="flex max-w-[85%] items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-secondary-foreground">
              {message.content}
            </div>
          </div>
          {selectMode && <CheckMark checked={checked} className="mt-2" />}
        </div>
        <div className="mt-1 flex justify-end gap-0.5 opacity-40 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 has-[.fav-on]:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 gap-1 px-1.5 text-[11px]",
              favorited
                ? "fav-on text-amber-500 hover:text-amber-500"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={onToggleFavorite}
            title={favorited ? "取消收藏" : "收藏此消息"}
          >
            <Star className={cn("size-3", favorited && "fill-current")} />
            {favorited ? "已收藏" : "收藏"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onAddToBoard}
            title="把这条消息放到画板"
          >
            <LayoutGrid className="size-3" />
            加入画板
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onBranch}
          >
            <GitBranch className="size-3" />
            分支
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={copy}
          >
            <Copy className="size-3" />
            复制
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group/msg",
        selectMode && "cursor-pointer rounded-xl px-2 py-1.5 transition-colors",
        selectMode && (checked ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/60")
      )}
      data-message-id={message.id}
      onClick={selectMode ? onToggleCheck : undefined}
    >
      <div className="mb-1.5 flex items-center gap-2">
        {selectMode ? (
          <CheckMark checked={checked} />
        ) : (
          <div className="flex size-5 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-background">
            DS
          </div>
        )}
        <span className="text-xs font-medium text-muted-foreground">DeepSeek</span>
        {favorited && (
          <Star className="size-3 fill-current text-amber-500" />
        )}
      </div>

      <div className="pl-7">
        {message.reasoning && (
          <ReasoningBlock
            text={message.reasoning}
            streaming={!!message.streaming && !message.content}
          />
        )}

        {message.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{message.error}</span>
          </div>
        ) : message.content ? (
          <Markdown content={message.content} />
        ) : message.streaming ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current" />
          </div>
        ) : null}

        {message.streaming && message.content && <TypingCursor />}

        {!message.streaming && message.content && (
          <div
            className={cn(
              "mt-2 flex flex-wrap items-center gap-0.5 transition-opacity focus-within:opacity-100 has-[.fav-on]:opacity-100 group-hover/msg:opacity-100",
              isLast ? "opacity-70" : "opacity-40"
            )}
          >
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 gap-1 px-1.5 text-[11px]",
                favorited
                  ? "fav-on text-amber-500 hover:text-amber-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={onToggleFavorite}
              title={favorited ? "取消收藏" : "收藏此消息"}
            >
              <Star className={cn("size-3", favorited && "fill-current")} />
              {favorited ? "已收藏" : "收藏"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onAddToBoard}
              title="把这条消息放到画板"
            >
              <LayoutGrid className="size-3" />
              加入画板
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={copy}
            >
              <Copy className="size-3" />
              复制
            </Button>
            {isLast && canRegenerate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={onRegenerate}
              >
                <RefreshCw className="size-3" />
                重新生成
              </Button>
            )}
            {canRegenerate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={onBranch}
                title="从此处另开一个对话，包含到这里的全部历史"
              >
                <GitBranch className="size-3" />
                分支
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)

  // 思考结束后自动收起，但用户手动展开后不强行干预
  const wasStreaming = useRef(streaming)
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false)
    wasStreaming.current = streaming
  }, [streaming])

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5" />
        <span>{streaming ? "思考中…" : "已深度思考"}</span>
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Composer({
  isStreaming,
  model,
  onSend,
  onStop,
  onOpenSettings,
  draft,
  onDraftConsumed,
  activeConversationId,
  history,
}: {
  isStreaming: boolean
  model: string
  onSend: (text: string) => void
  onStop: () => void
  onOpenSettings: () => void
  draft: string
  onDraftConsumed: () => void
  activeConversationId: string | null
  history: import("@/components/prompt-history").PromptHistoryApi
}) {
  const [value, setValue] = useState("")
  // ref 必须在下面的 effect 使用前声明，否则读起来像是用了未来的变量
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 由历史面板填入的草稿
  useEffect(() => {
    if (draft) {
      setValue(draft)
      onDraftConsumed()
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }, [draft, onDraftConsumed])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function submit() {
    if (!value.trim() || isStreaming) return
    history.record(activeConversationId, value, "chat")
    onSend(value)
    setValue("")
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const modelLabel = MODELS.find((m) => m.value === model)?.label ?? model

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring/40">
      <Textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="输入消息，Enter 发送，Shift + Enter 换行"
        className="max-h-[200px] min-h-[52px] resize-none border-0 bg-transparent px-3.5 pt-3.5 pb-1 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          title="模型设置"
        >
          {modelLabel}
        </Button>
        <div className="flex-1" />
        {isStreaming ? (
          <Button size="icon" variant="secondary" className="size-8" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-8"
            onClick={submit}
            disabled={!value.trim()}
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

export type { Conversation }

/* ------------------------------------------------------------------ */

/**
 * 顶栏对话快速切换：类似 DeepSeek 网页版的历史下拉。
 * 支持搜索、展示最近对话、键盘上下选择。
 */
function ConversationSwitcher({ store }: { store: ChatStore }) {
  const { projectConversations, activeConversation, selectConversation, addConversation } = store
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = projectConversations.filter((c) => !c.archived)
    if (!q) return base
    return base.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    )
  }, [projectConversations, query])

  useEffect(() => {
    if (open) {
      setQuery("")
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setCursor(0), [query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, list.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const target = list[cursor]
      if (target) {
        selectConversation(target.id)
        setOpen(false)
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="group/sw flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 -ml-1 text-left transition-colors hover:bg-accent/60"
            title="切换对话"
          >
            <span className="truncate text-sm font-medium">
              {activeConversation?.title ?? "新对话"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/sw:opacity-100" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-[min(520px,90vw)] p-0">
        {/* 搜索 */}
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="搜索对话"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1">
          {list.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {query ? "没有匹配的对话" : "当前项目还没有对话"}
            </div>
          ) : (
            list.map((c, i) => {
              const active = c.id === activeConversation?.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    selectConversation(c.id)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    i === cursor && "bg-accent",
                    active && "font-medium"
                  )}
                >
                  {c.pinned ? (
                    <Pin className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : c.branchedFrom ? (
                    <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {c.messages.length > 0 ? `${c.messages.length} 条` : "空"}
                  </span>
                  {active && <Check className="size-3.5 shrink-0" />}
                </button>
              )
            })
          )}
        </div>

        <Separator />
        <button
          type="button"
          onClick={() => {
            addConversation()
            setOpen(false)
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          <Plus className="size-3.5" />
          新建对话
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
