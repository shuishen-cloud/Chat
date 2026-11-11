import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ArrowUp,
  GitBranch,
  GripHorizontal,
  Loader2,
  Maximize2,
  Minimize2,
  Quote,
  Square,
  Star,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/markdown"
import { streamChat } from "@/lib/deepseek"
import type { ChatStore } from "@/hooks/use-chat-store"
import { cn } from "@/lib/utils"

/** 一次选区上下文 */
export interface SelectionContext {
  text: string
  /** 选区所在的消息 */
  messageId: string
  conversationId: string
  /** 选区矩形（视口坐标） */
  rect: { top: number; left: number; width: number; height: number }
}

interface Props {
  /** 该悬浮窗固定的上下文（创建时锁定，不随选区变化） */
  ctx: SelectionContext
  /** 初始位置，通常取选区矩形 */
  initialRect: { top: number; left: number; width: number; height: number }
  /** 创建后自动展开（而非先显示气泡） */
  autoOpen?: boolean
  /** 序号，用于错位排布 */
  index: number
  /** 点击气泡「收藏片段」时的回调 */
  onQuoteFavorite: (ctx: SelectionContext) => void
  /** 关闭并移除该悬浮窗 */
  onClose: () => void
  /** 点气泡「追问」时通知外层升级为展开窗口 */
  onAsk?: () => void
  /** 仅作为气泡存在，不自行展开 */
  bubbleOnly?: boolean
  store: ChatStore
}

type Phase = "idle" | "asking" | "answered" | "error"

const MIN_W = 320
const MIN_H = 220
/** 大对话模式距视口边缘的留白 */
const EXPAND_MARGIN = 24

/** 限制在视口内 */
function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

/**
 * 选中文本后浮出的气泡：
 *  - 追问：展开可拖动/缩放的悬浮窗，就地提问（回答支持 Markdown）
 *  - 收藏：直接把选中片段加入收藏
 */
export function SelectionQuickAsk({
  ctx,
  initialRect,
  autoOpen = false,
  index,
  onQuoteFavorite,
  onClose,
  onAsk,
  bubbleOnly = false,
  store,
}: Props) {
  const { state, branchFrom } = store

  // 展开状态完全由外部 autoOpen 决定：同一选区升级为窗口时会换 key 重建
  const open = autoOpen
  const [question, setQuestion] = useState("")
  const [askedQuestion, setAskedQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  /** 气泡锚点（收起态用） */
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)

  /** 悬浮窗位置与尺寸（展开态用，用户可拖动缩放） */
  const [frame, setFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  )
  /** 用户是否手动调整过，调整过则不再自动跟随选区 */
  const userAdjusted = useRef(false)

  /** 是否展开为大对话（占满视口） */
  const [expanded, setExpanded] = useState(false)
  /** 展开前的尺寸，用于返回原浮窗 */
  const beforeExpand = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // 计算气泡锚点（固定，不随选区变化）
  useLayoutEffect(() => {
    const vw = window.innerWidth
    setAnchor({
      top: initialRect.top,
      left: clamp(initialRect.left + initialRect.width / 2, 80, vw - 80),
    })
  }, [initialRect.top, initialRect.left, initialRect.width])

  // 展开时初始化悬浮窗位置（跟随选区，除非用户已手动调整）
  useLayoutEffect(() => {
    if (!open || !ctx) return
    if (userAdjusted.current && frame) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = 420
    const h = 460
    // 多个窗口依次错开 28px，避免完全重叠
    const offset = (index % 5) * 28
    const x = clamp(initialRect.left + initialRect.width / 2 - w / 2 + offset, 8, vw - w - 8)
    const y = clamp(initialRect.top + 12 + offset, 8, vh - h - 8)
    setFrame({ x, y, w, h })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  // 点击外部关闭：只有当点在「另一条消息/空白正文」时才关闭，
  // 点侧边栏、收藏面板等辅助 UI 不应关掉悬浮窗。
  useEffect(() => {
    if (!open || bubbleOnly) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (boxRef.current?.contains(target)) return
      // 采用白名单：只有点在这些区域才关闭。
      // 未列出的新面板一律保留窗口，避免每加一个 UI 就踩一次坑。
      const closable =
        target.closest("main") &&
        !target.closest("[data-qa]") &&
        !target.closest("[data-message-id]") &&
        !target.closest("[data-aux-panel]") &&
        !target.closest("aside") &&
        !target.closest("[data-slot='dialog-content']") &&
        !target.closest("[data-sonner-toaster]")
      if (!closable) return
      onClose()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, onClose, bubbleOnly])

  /* ---------------- 拖动 ---------------- */

  const dragState = useRef<{ dx: number; dy: number } | null>(null)

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return
      if (!frame) return
      e.preventDefault()
      dragState.current = { dx: e.clientX - frame.x, dy: e.clientY - frame.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [frame]
  )

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current || !frame) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const x = clamp(e.clientX - dragState.current.dx, 0, vw - frame.w)
      const y = clamp(e.clientY - dragState.current.dy, 0, vh - 40)
      setFrame({ ...frame, x, y })
      userAdjusted.current = true
    },
    [frame]
  )

  const onHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    dragState.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }, [])

  /* ---------------- 缩放 ---------------- */

  const resizeState = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null)

  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      if (!frame) return
      e.preventDefault()
      e.stopPropagation()
      resizeState.current = { sx: e.clientX, sy: e.clientY, w: frame.w, h: frame.h }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [frame]
  )

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeState.current || !frame) return
      const { sx, sy, w, h } = resizeState.current
      const vw = window.innerWidth
      const vh = window.innerHeight
      const nextW = clamp(w + (e.clientX - sx), MIN_W, vw - frame.x - 8)
      const nextH = clamp(h + (e.clientY - sy), MIN_H, vh - frame.y - 8)
      setFrame({ ...frame, w: nextW, h: nextH })
      userAdjusted.current = true
    },
    [frame]
  )

  const onResizeUp = useCallback((e: React.PointerEvent) => {
    resizeState.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }, [])

  /* ---------------- 提问 ---------------- */

  const ask = useCallback(async () => {
    if (!question.trim() || phase === "asking") return

    const q = question.trim()
    setAskedQuestion(q)
    setQuestion("")
    setPhase("asking")
    setAnswer("")
    setError("")

    const controller = new AbortController()
    abortRef.current = controller

    let acc = ""
    try {
      await streamChat({
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
        messages: [
          {
            id: "ctx",
            role: "user",
            content: `下面是我在某段对话中选中的内容：\n\n"""\n${ctx.text}\n"""\n\n请基于它回答：${q}`,
            createdAt: Date.now(),
          },
        ],
        signal: controller.signal,
        onDelta: (d) => {
          acc += d
          setAnswer(acc)
        },
        onReasoning: () => {
          /* 悬浮问答不展示思维链 */
        },
      })
      setPhase("answered")
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setPhase(acc ? "answered" : "idle")
      } else {
        setError(err instanceof Error ? err.message : String(err))
        setPhase("error")
      }
    } finally {
      abortRef.current = null
    }
  }, [question, phase, state.apiKey, state.baseUrl, state.model])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** 存为当前对话的子对话（分支） */
  const saveAsBranch = useCallback(() => {
    if (!answer) return
    const id = branchFrom(ctx.conversationId, ctx.messageId, {
      append: [
        { role: "user", content: askedQuestion },
        { role: "assistant", content: answer },
      ],
      activate: true,
    })
    if (id) toast.success("已存为子对话")
    onClose()
  }, [ctx, answer, askedQuestion, branchFrom, onClose])

  /** 收藏这轮问答：收藏原消息，并把提问与回答写入备注 */
  const favoriteAnswer = useCallback(() => {
    if (!answer) return
    const existing = store.favoriteOf(ctx.conversationId, ctx.messageId)
    const prev = existing?.note?.trim()
    const note = [prev, `Q：${askedQuestion}`, `A：${answer.trim()}`]
      .filter(Boolean)
      .join("\n\n")
    store.favoriteWithNote(ctx.conversationId, ctx.messageId, note)
    toast.success("已收藏这轮问答")
    onClose()
  }, [ctx, answer, askedQuestion, store, onClose])

  if (!anchor) return null

  /* ---------------- 收起态：小气泡 ---------------- */
  if (!open) {
    return (
      <div
        ref={boxRef}
        data-qa="bubble"
        data-qa-msg={ctx.messageId}
        className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-lg"
        style={{ top: anchor.top - 6, left: anchor.left }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => {
            if (bubbleOnly) {
              onAsk?.()
              return
            }
            requestAnimationFrame(() => taRef.current?.focus())
          }}
        >
          <Quote className="size-3" />
          追问
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => onQuoteFavorite(ctx)}
        >
          <Star className="size-3" />
          收藏
        </Button>
      </div>
    )
  }

  if (!frame) return null

  /* ---------------- 展开态：可拖动缩放的悬浮窗 ---------------- */
  return (
    <div
      ref={boxRef}
      data-qa="window"
      data-qa-msg={ctx.messageId}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
      style={
        expanded
          ? { left: EXPAND_MARGIN, top: EXPAND_MARGIN,
              width: `calc(100vw - ${EXPAND_MARGIN * 2}px)`,
              height: `calc(100vh - ${EXPAND_MARGIN * 2}px)` }
          : { left: frame.x, top: frame.y, width: frame.w, height: frame.h }
      }
    >
      {/* 标题栏（拖动区） */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5",
          expanded
            ? ""
            : "cursor-grab touch-none active:cursor-grabbing"
        )}
        onPointerDown={expanded ? undefined : onHeaderPointerDown}
        onPointerMove={expanded ? undefined : onHeaderPointerMove}
        onPointerUp={expanded ? undefined : onHeaderPointerUp}
        onPointerCancel={expanded ? undefined : onHeaderPointerUp}
      >
        {expanded ? (
          <Quote className="size-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <span className="flex-1 truncate text-[11px] font-medium text-muted-foreground select-none">
          {expanded ? "大对话" : "基于所选内容追问"}
        </span>
        {expanded ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
            title="收回到悬浮窗"
            onClick={() => {
              setExpanded(false)
              if (beforeExpand.current) setFrame(beforeExpand.current)
            }}
          >
            <Minimize2 className="size-3" />
            返回浮窗
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0"
            title="展开为大对话"
            onClick={() => {
              beforeExpand.current = frame
              setExpanded(true)
            }}
          >
            <Maximize2 className="size-3" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-5 shrink-0"
          onClick={onClose}
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* 引用片段 */}
      <div
        className={cn(
          "shrink-0 overflow-y-auto border-b border-border bg-muted/50 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground",
          expanded ? "max-h-24 px-8 py-2" : "max-h-16 px-2.5 py-1.5"
        )}
      >
        <div className={cn(expanded && "mx-auto w-full max-w-3xl")}>
          {ctx.text.length > (expanded ? 800 : 300)
            ? `${ctx.text.slice(0, expanded ? 800 : 300)}…`
            : ctx.text}
        </div>
      </div>

      {/* 对话区（占满剩余空间） */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-2.5 py-2",
          expanded && "px-8 py-5"
        )}
      >
        <div className={cn(expanded && "mx-auto w-full max-w-3xl")}>
        {!askedQuestion && phase === "idle" ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
            <Quote className="size-4 opacity-40" />
            <span>针对选中内容提问</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {askedQuestion && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-secondary px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words text-secondary-foreground">
                  {askedQuestion}
                </div>
              </div>
            )}

            {(answer || phase === "asking") && (
              <div className="flex flex-col gap-1">
                <span className="w-fit rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  AI
                </span>
                {answer ? (
                  <Markdown content={answer} className="text-xs" />
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    思考中…
                  </span>
                )}
              </div>
            )}

            {phase === "error" && (
              <div className="text-[11px] text-destructive">{error}</div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* 输入区 */}
      <div className={cn("shrink-0 border-t border-border p-2", expanded && "px-8 py-3")}>
        <div className={cn(expanded && "mx-auto w-full max-w-3xl")}>
        <Textarea
          ref={taRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ask()
            }
            if (e.key === "Escape") onClose()
          }}
          placeholder="针对这段内容提问…（Enter 发送）"
          rows={2}
          disabled={phase === "asking"}
          className="min-h-[46px] resize-none border-0 bg-transparent px-1 py-1 text-xs shadow-none focus-visible:ring-0"
        />

        <div className="flex items-center gap-1 pt-1">
          {phase === "answered" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={saveAsBranch}
                title="把这轮问答存为当前对话的子对话"
              >
                <GitBranch className="size-3" />
                存为子对话
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={favoriteAnswer}
              >
                <Star className="size-3" />
                收藏
              </Button>
            </>
          )}
          <div className="flex-1" />
          {phase === "asking" ? (
            <Button size="icon" variant="secondary" className="size-6" onClick={stop}>
              <Square className="size-3" />
            </Button>
          ) : (
            <Button size="icon" className="size-6" onClick={ask} disabled={!question.trim()}>
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
        </div>
      </div>

      {/* 缩放手柄（展开态隐藏） */}
      {!expanded && (
      <div
        className={cn(
          "absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none",
          "after:absolute after:right-1 after:bottom-1 after:size-2 after:border-r after:border-b after:border-muted-foreground/40"
        )}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        title="拖动调整大小"
      />
      )}
    </div>
  )
}
