import { useState } from "react"
import { AlertCircle, ArrowDownToLine, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { NodeRun } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * 节点运行历史。
 *
 * 用结构化卡片而不是一段裸文本：每次执行都记下当时的提示词与输入，
 * 失败项用红色区分并展示错误信息，成功的可以一键「回填」到节点当前内容。
 */
export function HistoryList({
  runs,
  onApply,
  onClose,
}: {
  runs: NodeRun[]
  onApply: (runId: string) => void
  onClose: () => void
}) {
  /** 同时只展开一条，避免长历史把卡片撑爆 */
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div
      data-history
      className="max-h-[260px] shrink-0 overflow-y-auto border-t border-current/10 bg-background/60 p-1.5 backdrop-blur-sm"
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground">
          运行历史 · {runs.length}
        </span>
        <Button variant="ghost" size="icon" className="size-4" onClick={onClose}>
          <X className="size-2.5" />
        </Button>
      </div>

      {runs.map((r) => {
        const isOpen = expanded === r.id
        const fail = !!r.error
        return (
          <div
            key={r.id}
            className={cn(
              "mb-1 overflow-hidden rounded-lg border text-[10px]",
              fail ? "border-destructive/40 bg-destructive/5" : "border-border/70 bg-card"
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-1 px-1.5 py-1 text-left transition-colors hover:bg-muted/50"
              onClick={() => setExpanded(isOpen ? null : r.id)}
            >
              {fail ? (
                <AlertCircle className="size-2.5 shrink-0 text-destructive" />
              ) : (
                <ArrowDownToLine className="size-2.5 shrink-0 text-muted-foreground" />
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatRunTime(r.createdAt)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-medium",
                  fail ? "text-destructive" : "text-foreground/80"
                )}
              >
                {r.prompt || "无提示词"}
              </span>
              {!fail && (
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 rounded px-1 text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    onApply(r.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation()
                      onApply(r.id)
                    }
                  }}
                >
                  回填
                </span>
              )}
            </button>

            {isOpen ? (
              <div className="space-y-1.5 border-t border-border/60 px-1.5 py-1.5">
                {r.inputs.map((inp, i) => (
                  <div key={i}>
                    <div className="mb-0.5 text-[9px] font-medium text-muted-foreground">
                      输入 · {inp.title}
                    </div>
                    <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1 leading-relaxed">
                      {inp.text}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="mb-0.5 text-[9px] font-medium text-muted-foreground">
                    {fail ? "错误" : "输出"}
                  </div>
                  <div
                    className={cn(
                      "max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded p-1 leading-relaxed",
                      fail ? "bg-destructive/10 text-destructive" : "bg-muted/50"
                    )}
                  >
                    {r.error ?? r.output}
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-1.5 pb-1">
                <div
                  className={cn(
                    "line-clamp-2 break-words leading-relaxed",
                    fail ? "text-destructive/90" : "text-muted-foreground"
                  )}
                >
                  {r.error ?? r.output}
                </div>
                <div className="mt-0.5 text-[9px] text-muted-foreground/70">
                  输入 {r.inputs.length} 项 · 点击展开
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 今天只显示时分秒，跨天补日期 */
function formatRunTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hms = d.toLocaleTimeString()
  return sameDay ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms.slice(0, 5)}`
}
