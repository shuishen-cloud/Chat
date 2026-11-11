import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  SelectionQuickAsk,
  type SelectionContext,
} from "@/components/selection-quick-ask"
import type { ChatStore } from "@/hooks/use-chat-store"

interface Props {
  /** 实时选区，用于创建/更新气泡 */
  selection: SelectionContext | null
  /** 清空浏览器选区 */
  clearSelection: () => void
  /** 当前对话 id */
  conversationId: string | null
  /** 提示词历史 */
  history: import("@/components/prompt-history").PromptHistoryApi
  store: ChatStore
}

interface Instance {
  key: string
  ctx: SelectionContext
  /** 是否直接展开为悬浮窗（追问过） */
  asked: boolean
}

let seq = 0
/**
 * 去重键：同一对话 + 同一消息 + 同一段文本 才视为同一个悬浮窗。
 * 只按 messageId 去重会导致「在同一消息里另选一段」时气泡不出来。
 */
const sigOf = (c: SelectionContext) =>
  `${c.conversationId}:${c.messageId}:${c.text.trim()}`

/**
 * 悬浮追问层：管理多个悬浮窗实例。
 * - 每个不同选区各自独立一个窗口
 * - 同选区重复选中不会重复创建
 */
export function QuickAskLayer({
  selection,
  clearSelection,
  conversationId,
  history,
  store,
}: Props) {
  const [instances, setInstances] = useState<Instance[]>([])
  // 用 ref 暴露最新 promote，避免气泡里闭包捕获旧值
  const promoteRef = useRef<(c: SelectionContext) => void>(() => {})
  /** 已展开过追问的选区签名，避免气泡重复出现（用 state 以便触发重渲染） */
  const [askedSigs, setAskedSigs] = useState<Set<string>>(() => new Set())

  const close = useCallback((key: string) => {
    setInstances((prev) => {
      const target = prev.find((i) => i.key === key)
      if (target) {
        const sig = sigOf(target.ctx)
        setAskedSigs((s) => {
          const next = new Set(s)
          next.delete(sig)
          return next
        })
      }
      return prev.filter((i) => i.key !== key)
    })
  }, [])

  /** 气泡点「追问」：把当前选区转成展开态实例 */
  const promote = useCallback((ctx: SelectionContext) => {
    const sig = sigOf(ctx)
    seq += 1
    setInstances((prev) =>
      prev.some((i) => sigOf(i.ctx) === sig)
        ? prev
        : [...prev, { key: `qa_${Date.now()}_${seq}`, ctx, asked: true }]
    )
    setAskedSigs((s) => (s.has(sig) ? s : new Set(s).add(sig)))
  }, [])

  useEffect(() => {
    promoteRef.current = promote
  }, [promote])

  const favoriteQuote = useCallback(
    (ctx: SelectionContext) => {
      const exists = store.favoriteOf(ctx.conversationId, ctx.messageId)
      if (!exists) store.toggleFavorite(ctx.conversationId, ctx.messageId)
      toast.success("已收藏这段内容")
      clearSelection()
    },
    [store, clearSelection]
  )

  // 当前选区是否已经有展开的窗口
  const liveCtx =
    selection && conversationId ? { ...selection, conversationId } : null
  const liveSig = liveCtx ? sigOf(liveCtx) : null
  const alreadyExpanded = liveSig ? askedSigs.has(liveSig) : false

  return (
    <>
      {/* 已展开的窗口：包在独立容器，避免与下方气泡在 children 中串位 */}
      <div data-qa-group="windows">
      {/* 已展开的窗口：固定顺序，key 含 messageId 保证身份稳定 */}
      {instances.map((inst, idx) => (
        <SelectionQuickAsk
          key={`win:${inst.ctx.messageId}:${inst.key}`}
          ctx={inst.ctx}
          initialRect={inst.ctx.rect}
          index={idx}
          autoOpen
          history={history}
          store={store}
          onClose={() => close(inst.key)}
          onQuoteFavorite={favoriteQuote}
          onAsk={() => promoteRef.current(inst.ctx)}
        />
      ))}
      </div>

      {/* 新选区的气泡：独立容器 */}
      <div data-qa-group="bubbles">
      {liveCtx && !alreadyExpanded && (
        <SelectionQuickAsk
          key={`bubble:${liveCtx.messageId}`}
          ctx={liveCtx}
          initialRect={liveCtx.rect}
          index={instances.length}
          autoOpen={false}
          history={history}
          store={store}
          onClose={() => clearSelection()}
          onQuoteFavorite={favoriteQuote}
          onAsk={() => promoteRef.current(liveCtx)}
          bubbleOnly
        />
      )}
      </div>
    </>
  )
}
