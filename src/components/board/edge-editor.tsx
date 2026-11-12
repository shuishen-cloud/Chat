import { useState } from "react"
import { Check, MessageSquare, Play, Trash2, X, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { HuePicker } from "@/components/hue-picker"
import type { BoardEdge } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * 连线悬浮编辑器。
 *
 * 出现在长按/点击线的位置（锚点是屏幕上的按下点），刻意不用全屏遮罩：
 * 点其他线/卡片时可以直接切换，不打断画布操作。
 *
 * 三个概念严格分开（见 doc/feat/edge-inline-editor.md §三）：
 *  - **线条文字**（label）：画在线上，任何线都能有，输入即写回；
 *  - **执行提示词**（prompt）：送模型的要求，只在「即执行」开启时有意义，
 *    为了不每敲一个字就写 localStorage，编辑中留在本地，「保存 / 立即执行」时落库；
 *  - **即执行**（kind + enabled）：整条线的执行语义，一个开关决定——
 *    开 = 点击线即执行，关 = 纯视觉联系。
 *
 * 颜色只保留一个取色器：线、箭头、文字徽章同源，避免两套配色打架。
 */
export function EdgeEditor({
  edge,
  anchor,
  running,
  onClose,
  onUpdate,
  onSetLabel,
  onSetInstant,
  onSetHue,
  onRun,
  onDelete,
}: {
  edge: BoardEdge
  /** 悬浮窗定位点（屏幕坐标），来自按下位置 */
  anchor: { x: number; y: number }
  running: boolean
  onClose: () => void
  onUpdate: (patch: Partial<Pick<BoardEdge, "prompt" | "promptHue">>) => void
  onSetLabel: (label: string) => void
  onSetInstant: (on: boolean) => void
  onSetHue: (hue: number | undefined) => void
  onRun: () => void
  onDelete: () => void
}) {
  /** 提示词在本地编辑，保存时才写回 */
  const [prompt, setPrompt] = useState(edge.prompt ?? "")
  const instant = edge.kind === "flow"

  /** 保存：只写有变化的字段，避免无意义的状态变更 */
  const save = () => {
    if (instant && prompt !== (edge.prompt ?? "")) onUpdate({ prompt })
  }

  return (
    <div
      className="absolute z-20 w-[340px] rounded-xl border border-border bg-card p-3 shadow-xl"
      style={{
        // 贴着按下点，但别超出视口
        left: Math.min(Math.max(anchor.x - 24, 8), Math.max(window.innerWidth - 356, 8)),
        top: Math.min(Math.max(anchor.y - 16, 8), Math.max(window.innerHeight - 340, 8)),
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          save()
          if (instant && edge.enabled !== false) onRun()
        }
      }}
      role="dialog"
      aria-label="连线设置"
    >
      <div className="mb-2 flex items-center gap-2">
        <Zap className={cn("size-4", instant ? "text-primary" : "text-muted-foreground")} />
        <span className="flex-1 text-sm font-medium">连线设置</span>
        <Button variant="ghost" size="icon" className="size-6" onClick={onClose} aria-label="关闭">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* 线条文字：任何线都能有，输入即写回 */}
      <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="edge-label">
        线条文字（显示在这条线上）
      </label>
      <Input
        id="edge-label"
        autoFocus
        value={edge.label ?? ""}
        onChange={(e) => onSetLabel(e.target.value)}
        placeholder="例如：前置条件 / 反例 / 待验证"
        className="h-7 text-xs"
      />

      {/* 执行提示词：只有即执行的线才有意义 */}
      <div className="mt-2 flex items-center gap-1.5">
        <MessageSquare className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium">执行提示词</span>
        {!instant && (
          <span className="text-[10px] text-muted-foreground">（开启「即执行」后可填）</span>
        )}
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={save}
        disabled={!instant}
        placeholder={
          instant ? "这条线要做什么？会与起点材料一起发给模型" : "这条线不参与执行"
        }
        rows={3}
        className="mt-1 text-xs disabled:opacity-50"
      />

      {/* 线条颜色：一个取色器管线、箭头、文字 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-[11px] text-muted-foreground">线条颜色</span>
        <HuePicker value={edge.hue} onChange={onSetHue} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* 即执行：kind + enabled 收敛成一个开关 */}
        <button
          type="button"
          role="switch"
          aria-checked={instant}
          onClick={() => onSetInstant(!instant)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
            instant
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
          title="开启后，点击这条线就会直接执行"
        >
          <span
            className={cn(
              "relative h-3.5 w-6 rounded-full transition-colors",
              instant ? "bg-primary" : "bg-muted-foreground/40"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-2.5 rounded-full bg-background transition-all",
                instant ? "left-3" : "left-0.5"
              )}
            />
          </span>
          即执行
        </button>

        <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => { save(); onClose() }}>
          <Check className="size-3" />
          保存
        </Button>
        {instant && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={running}
            onClick={() => {
              // 先存下当前提示词，避免改了没保存就执行导致用的是旧值
              save()
              onRun()
            }}
            title="立即执行这一条线（Ctrl/Cmd+Enter）"
          >
            <Play className="size-3" />
            {running ? "执行中…" : "立即执行"}
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

      {instant && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          即执行已开启：关闭本窗口后，直接点击这条线即可执行。
        </p>
      )}
    </div>
  )
}
