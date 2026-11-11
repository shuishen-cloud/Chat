import { useState } from "react"
import { Check, Play, Trash2, X, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { HuePicker } from "@/components/hue-picker"
import type { BoardEdge } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * 连线编辑器浮层。
 *
 * 刻意不用全屏遮罩：点其他线/卡片时可以直接切换，不打断画布操作。
 * 提示词先在本地 state 里编辑，保存时才写回 store；
 * 「立即执行」会先落库再执行，避免用户改了没保存却用旧值跑。
 */
export function EdgeEditor({
  edge,
  anchor,
  running,
  onClose,
  onUpdate,
  onToggleKind,
  onToggleEnabled,
  onSetHue,
  onRun,
  onDelete,
}: {
  edge: BoardEdge
  /** 悬浮窗定位点（屏幕坐标），来自点击位置 */
  anchor: { x: number; y: number }
  running: boolean
  onClose: () => void
  onUpdate: (patch: Partial<Pick<BoardEdge, "prompt" | "promptHue">>) => void
  onToggleKind: () => void
  onToggleEnabled: () => void
  onSetHue: (hue: number | undefined) => void
  onRun: () => void
  onDelete: () => void
}) {
  const [prompt, setPrompt] = useState(edge.prompt ?? "")
  const runnable = edge.kind === "flow"

  return (
    <div
      className="absolute z-20 w-[340px] rounded-xl border border-border bg-card p-3 shadow-xl"
      style={{
        // 贴着点击处，但别超出视口
        left: Math.min(Math.max(anchor.x + 12, 8), Math.max(window.innerWidth - 360, 8)),
        top: Math.min(Math.max(anchor.y - 24, 8), Math.max(window.innerHeight - 320, 8)),
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="mb-2 flex items-center gap-2">
        <Zap
          className={cn(
            "size-4",
            runnable ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="flex-1 text-sm font-medium">
          {runnable ? "可执行连线" : "仅联系"}
        </span>
        <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {runnable ? (
        <>
          <label className="mb-1 block text-[11px] text-muted-foreground">
            这条线要做什么（会与起点材料一起发给模型）
          </label>
          <Textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="这条线要做什么？"
            rows={4}
            className="text-xs"
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          纯视觉联系，不参与任务执行。切换为「可执行」后可以填写提示词。
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-[11px] text-muted-foreground">线条颜色</span>
        <HuePicker value={edge.hue} onChange={onSetHue} />
      </div>
      {runnable && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">提示词色</span>
          <HuePicker
            value={edge.promptHue}
            onChange={(h) => onUpdate({ promptHue: h })}
          />
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => {
            onUpdate({ prompt })
            onClose()
          }}
        >
          <Check className="size-3" />
          保存
        </Button>
        {runnable && edge.enabled !== false && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={running}
            onClick={() => {
              // 先存下当前提示词，避免用户改了没保存就执行导致用的是旧值
              onUpdate({ prompt })
              onRun()
            }}
            title="立即执行这一条线（Ctrl/Cmd+Enter）"
          >
            <Play className="size-3" />
            {running ? "执行中…" : "立即执行"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onToggleKind}
        >
          {runnable ? "改为仅联系" : "改为可执行"}
        </Button>
        {runnable && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onToggleEnabled}
          >
            {edge.enabled === false ? "启用此线" : "禁用此线"}
          </Button>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
          删除
        </Button>
      </div>
    </div>
  )
}
