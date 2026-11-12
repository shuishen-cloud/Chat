/**
 * 正文区：只读渲染 / 编辑态切换。
 *
 * 两种卡片都需要这段逻辑（v1 里各写了一遍，还写得不一致），
 * 抽出来后只有一个地方处理 Esc 取消、失焦提交、撑满与滚动。
 *
 * 编辑草稿完全受控：内部 useState 持有 draft，进入编辑时用 `initial`
 * 快照一次。不依赖任何模块级可变状态。
 */
import { useEffect, useState, type ReactNode } from "react"

import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export function BodyEditor({
  editing,
  initial,
  value,
  sized,
  expanded,
  placeholder,
  onStartEdit,
  onCommit,
  onCancel,
  renderReadonly,
  mono,
}: {
  editing: boolean
  /** 进入编辑态时的初值 */
  initial: string
  /** 只读时展示的文本 */
  value: string
  sized: boolean
  expanded: boolean
  placeholder?: string
  /** 只读区被点击/回车时触发，由父组件置 editing=true */
  onStartEdit: () => void
  onCommit: (text: string) => void
  onCancel: () => void
  renderReadonly: (text: string) => ReactNode
  /** 便签用等宽字体更像记事本 */
  mono?: boolean
}) {
  const [draft, setDraft] = useState(initial)

  // 每次进入编辑态都重新取初值，避免沿用上一次未提交的草稿
  useEffect(() => {
    if (editing) setDraft(initial)
    // initial 故意不进依赖：只在「进入编辑」这一刻快照
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (editing) {
    return (
      <div className={cn("flex min-h-0 flex-col gap-1", sized && "flex-1")}>
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onCommit(draft)
            }
          }}
          placeholder={placeholder}
          className={cn(
            "nodrag field-sizing-content min-h-[60px] resize-none border-0 bg-transparent p-2 text-xs leading-relaxed shadow-none focus-visible:ring-0",
            mono && "font-mono",
            sized && "min-h-0 flex-1 overflow-y-auto"
          )}
        />
        <div className="shrink-0 px-2.5 pb-1.5 text-[10px] text-muted-foreground">
          Esc 取消 · Ctrl/⌘+Enter 保存
        </div>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onStartEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onStartEdit()
      }}
      className={cn(
        "nodrag cursor-text px-2.5 py-2 text-xs leading-relaxed",
        mono && "font-mono",
        sized ? "min-h-0 flex-1 overflow-y-auto" : expanded ? "" : "max-h-[440px] overflow-y-auto"
      )}
    >
      {renderReadonly(value)}
    </div>
  )
}
