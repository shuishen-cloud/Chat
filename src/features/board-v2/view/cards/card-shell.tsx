/**
 * 卡片通用外壳：两种卡片共享的头部、边框、颜色、尺寸逻辑。
 *
 * 设计约束（doc/feat/board-v2-rewrite.md §五）：
 * 这里**不做业务判断**——有没有运行历史、能不能跳回原消息，
 * 都由调用方通过 `actions` 传进来。卡片只负责画。
 */
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { hueBg, hueBorder, hueText } from "@/lib/hue"

export type CardTone = "message" | "note"

export function CardShell({
  tone,
  hue,
  dark,
  selected,
  sized,
  width,
  children,
  overlay,
}: {
  tone: CardTone
  hue?: number
  dark: boolean
  selected: boolean
  /** 尺寸是否被用户显式设置（显式时撑满节点盒） */
  sized: boolean
  /** 自适应时的默认宽度 */
  width: number
  children: ReactNode
  /**
   * 覆盖在卡片之上的控件（缩放手柄、连线手柄）。
   * 放在外层容器里，避免被卡片的 overflow-hidden 裁掉一半。
   */
  overlay?: ReactNode
}) {
  const note = tone === "note"
  const colored = hue !== undefined

  const style: React.CSSProperties = {}
  if (colored) {
    style.borderColor = hueBorder(hue, dark)
    style.backgroundColor = hueBg(hue, dark)
    if (note) style.color = hueText(hue, dark)
  }

  return (
    <div className="relative h-full w-full">
      <div
        className={cn(
          "relative z-0 flex h-full flex-col overflow-hidden rounded-xl border shadow-sm transition-shadow",
          !colored && !note && "bg-card text-card-foreground",
          !colored && note && "bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100",
          !colored && !note && "border-border",
          !colored &&
            note &&
            (selected ? "border-amber-500" : "border-amber-300/70 dark:border-amber-800"),
          selected && (note ? "ring-2 ring-amber-500/30" : "ring-2 ring-primary/30")
        )}
        style={{ width: sized ? "100%" : width, height: sized ? "100%" : undefined, ...style }}
      >
        {children}
      </div>
      {/*
       * 手柄与缩放控件必须在卡片**之上**（z-10）且位于同一个定位上下文内。
       * 之前放在卡片前面 + 没有 z-index，被卡片自身的背景完全盖住，
       * 结果是「看得到手柄、点不到手柄」。
       */}
      {overlay && <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div>}
    </div>
  )
}

/** 卡片头部：左侧标识 + 标题，右侧操作区 */
export function CardHeader({
  badge,
  badgeTone,
  title,
  leading,
  children,
}: {
  badge?: string
  badgeTone?: "user" | "assistant" | "note"
  title: string
  leading?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b px-2.5 py-1.5",
        badgeTone === "note" ? "border-current/10" : "border-border/60"
      )}
    >
      {leading}
      {badge && (
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
            badgeTone === "user" && "bg-foreground text-background",
            badgeTone === "assistant" && "bg-muted text-muted-foreground",
            badgeTone === "note" && "bg-current/10 opacity-70"
          )}
        >
          {badge}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** 头部图标按钮：统一 hover 表现，避免每个卡片各写一遍 */
export function CardIconButton({
  title,
  onClick,
  children,
  danger,
  tone,
}: {
  title: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
  tone?: CardTone
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "nodrag inline-flex size-5 shrink-0 items-center justify-center rounded transition-opacity",
        tone === "note"
          ? "text-current opacity-50 hover:opacity-100"
          : "opacity-50 hover:bg-muted hover:opacity-100",
        danger && "hover:text-destructive"
      )}
    >
      {children}
    </button>
  )
}
