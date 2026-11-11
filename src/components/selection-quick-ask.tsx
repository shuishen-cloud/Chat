import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, GitBranch, Loader2, Quote, Square, Star, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { streamChat } from "@/lib/deepseek"
import type { ChatStore } from "@/hooks/use-chat-store"

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
  /** 当前选区；为 null 时隐藏气泡 */
  selection: SelectionContext | null
  /** 点击气泡「收藏片段」时的回调 */
  onQuoteFavorite: (ctx: SelectionContext) => void
  store: ChatStore
}

type Phase = "idle" | "asking" | "answered" | "error"

/**
 * 选中文本后浮出的气泡：
 *  - 追问：展开悬浮窗，就地提问
 *  - 收藏：直接把选中片段加入收藏
 */
export function SelectionQuickAsk({ selection, onQuoteFavorite, store }: Props) {
  const { state, branchFrom } = store

  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  /** 已提交的问题，用于气泡内展示与备注 */
  const [askedQuestion, setAskedQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // 供 effect 读取最新 open 值
  const openRef = useRef(open)
  openRef.current = open

  // 记住最近一次有效选区，避免点按钮时选区被清空导致内容丢失
  const lastSelection = useRef<SelectionContext | null>(null)
  if (selection) lastSelection.current = selection
  const ctx = selection ?? (open ? lastSelection.current : null)

  // 选区变化时重置（换了一条消息/一段文本才重置）
  const sig = `${selection?.messageId ?? ""}::${selection?.text ?? ""}`
  const prevSig = useRef(sig)
  useEffect(() => {
    if (prevSig.current === sig) return
    prevSig.current = sig
    // 如果只是选区被清空（点按钮导致），保持展开
    if (!selection && openRef.current) return
    setOpen(false)
    setQuestion("")
    setAskedQuestion("")
    setAnswer("")
    setError("")
    setPhase("idle")
    abortRef.current?.abort()
    abortRef.current = null
  }, [sig, selection])


  // 计算气泡位置（选区上方居中，超出边界则下移）
  useLayoutEffect(() => {
    if (!ctx) {
      setPos(null)
      return
    }
    const { rect } = ctx
    let left = rect.left + rect.width / 2
    const top = rect.top
    // 简单防溢出
    const vw = window.innerWidth
    if (open) {
      left = Math.min(Math.max(8, left - 180), vw - 368)
    } else {
      left = Math.min(Math.max(70, left), vw - 70)
    }
    setPos({ top, left })
  }, [ctx, open])

  // 点击外部关闭悬浮窗
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const ask = useCallback(async () => {
    if (!ctx || !question.trim() || phase === "asking") return

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
        // 把选中片段作为上下文一并发送
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
  }, [ctx, question, phase, state.apiKey, state.baseUrl, state.model])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** 存为当前对话的子对话（分支） */
  const saveAsBranch = useCallback(() => {
    if (!ctx || !answer) return
    const id = branchFrom(ctx.conversationId, ctx.messageId, {
      append: [
        { role: "user", content: askedQuestion },
        { role: "assistant", content: answer },
      ],
      activate: true,
    })
    if (id) toast.success("已存为子对话")
    setOpen(false)
  }, [ctx, answer, askedQuestion, branchFrom])

  /** 收藏这轮问答：收藏原消息，并把提问与回答写入备注 */
  const favoriteAnswer = useCallback(() => {
    if (!ctx || !answer) return
    const existing = store.favoriteOf(ctx.conversationId, ctx.messageId)
    const prev = existing?.note?.trim()
    const note = [prev, `Q：${askedQuestion}`, `A：${answer.trim()}`]
      .filter(Boolean)
      .join("\n\n")
    store.favoriteWithNote(ctx.conversationId, ctx.messageId, note)
    toast.success("已收藏这轮问答")
    setOpen(false)
  }, [ctx, answer, askedQuestion, store])

  if (!ctx || !pos) return null

  /* ---------------- 收起态：小气泡 ---------------- */
  if (!open) {
    return (
      <div
        className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-lg"
        style={{ top: pos.top - 6, left: pos.left + 70 }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => {
            setOpen(true)
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

  /* ---------------- 展开态：悬浮问答窗 ---------------- */
  return (
    <div
      ref={boxRef}
      className="fixed z-50 flex w-[360px] -translate-x-1/2 flex-col rounded-xl border border-border bg-popover shadow-xl"
      style={{ top: Math.min(pos.top + 12, window.innerHeight - 320), left: pos.left + 180 }}
    >
      {/* 头部 */}
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <Quote className="size-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-medium text-muted-foreground">
          基于所选内容追问
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-5"
          onClick={() => setOpen(false)}
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* 引用片段 */}
      <div className="max-h-16 overflow-y-auto border-b border-border bg-muted/50 px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {ctx.text.length > 300 ? `${ctx.text.slice(0, 300)}…` : ctx.text}
      </div>

      {/* 我的提问 + 回答 */}
      {(askedQuestion || answer || phase === "asking") && (
        <div className="border-t border-border">
          {askedQuestion && (
            <div className="flex gap-1.5 px-2.5 pt-2 text-xs">
              <span className="mt-0.5 shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] text-secondary-foreground">
                我
              </span>
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                {askedQuestion}
              </span>
            </div>
          )}
          {(answer || phase === "asking") && (
            <div className="mt-1.5 max-h-52 overflow-y-auto px-2.5 pb-2 text-xs leading-relaxed whitespace-pre-wrap">
              <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                AI
              </span>
              {answer || (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  思考中…
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="px-2.5 py-2 text-[11px] text-destructive">{error}</div>
      )}

      {/* 输入 / 操作 */}
      <div className="border-t border-border p-2">
        <Textarea
          ref={taRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ask()
            }
            if (e.key === "Escape") setOpen(false)
          }}
          placeholder="针对这段内容提问…（Enter 发送）"
          rows={2}
          disabled={phase === "asking"}
          className="min-h-[52px] resize-none border-0 bg-transparent px-1 py-1 text-xs shadow-none focus-visible:ring-0"
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
            <Button
              size="icon"
              className="size-6"
              onClick={ask}
              disabled={!question.trim()}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
