import { useEffect, useRef, useState } from "react"
import {
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
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Markdown, TypingCursor } from "@/components/markdown"
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
}

export function ChatMain({ store, onOpenSettings }: Props) {
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
    clearConversation,
    deleteConversation,
    exportMarkdown,
    selectConversation,
  } = store

  const messages = activeConversation?.messages ?? []
  const lastContent = messages[messages.length - 1]?.content ?? ""
  const { ref: scrollRef } = useStickToBottom(
    `${activeConversation?.id ?? ""}:${messages.length}:${lastContent.length}`
  )

  // 选区追问
  const { selection, clear: clearSelection } = useSelectionWatcher(
    scrollRef,
    !!activeConversation && !isStreaming
  )

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {activeConversation?.title ?? "新对话"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activeProject?.name ?? "未选择项目"} · {state.model}
          </div>
        </div>

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
                    activeConversation && regenerate(activeConversation)
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
          />
          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            内容由 AI 生成，请自行甄别 · 仅支持 DeepSeek
          </div>
        </div>
      </div>

      <QuickAskLayer
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

function MessageBubble({
  message,
  isLast,
  canRegenerate,
  onRegenerate,
  onBranch,
  favorited,
  onToggleFavorite,
}: {
  message: Message
  isLast: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  onBranch: () => void
  favorited: boolean
  onToggleFavorite: () => void
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
      <div className="group/msg flex flex-col items-end" data-message-id={message.id}>
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-secondary-foreground">
            {message.content}
          </div>
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
    <div className="group/msg" data-message-id={message.id}>
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-background">
          DS
        </div>
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
}: {
  isStreaming: boolean
  model: string
  onSend: (text: string) => void
  onStop: () => void
  onOpenSettings: () => void
}) {
  const [value, setValue] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function submit() {
    if (!value.trim() || isStreaming) return
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
