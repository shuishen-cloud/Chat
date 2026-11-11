import { Ban, Check } from "lucide-react"
import { HUE_PRESETS, hueDot } from "@/lib/hue"
import { cn } from "@/lib/utils"

/**
 * 共享取色器：8 个固定预设色 + 无颜色。
 *
 * 用固定预设而非取色轮，是因为标记色的目的是「快速区分几类」，
 * 预设可预测、跨设备一致，也不用处理任意色在暗色下的对比度问题。
 */
export function HuePicker({
  value,
  onChange,
  className,
}: {
  value?: number
  onChange: (hue: number | undefined) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {HUE_PRESETS.map((hue) => {
        const active = value === hue
        return (
          <button
            key={hue}
            type="button"
            data-hue={hue}
            title={`颜色 ${hue}`}
            aria-label={`颜色 ${hue}`}
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : hue)}
            className={cn(
              "flex size-5 items-center justify-center rounded-full border transition-transform hover:scale-110",
              active ? "border-foreground" : "border-transparent"
            )}
            style={{ backgroundColor: hueDot(hue) }}
          >
            {active && <Check className="size-3 text-white" strokeWidth={3} />}
          </button>
        )
      })}
      <button
        type="button"
        data-hue-clear
        title="无颜色"
        aria-label="无颜色"
        onClick={() => onChange(undefined)}
        className={cn(
          "flex size-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:text-foreground",
          value === undefined && "border-solid border-foreground text-foreground"
        )}
      >
        <Ban className="size-3" />
      </button>
    </div>
  )
}
