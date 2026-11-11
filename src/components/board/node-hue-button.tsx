import { useState } from "react"
import { Palette } from "lucide-react"
import { HuePicker } from "@/components/hue-picker"
import { hueDot } from "@/lib/hue"
import { cn } from "@/lib/utils"

/**
 * 节点卡片上的颜色入口：一个小色点，点开即选。
 *
 * 未标记时显示为虚线空心圆，与已标记的实心色点区分开；
 * `nodrag` 类确保在 React Flow 里点它不会顺带拖动卡片。
 */
export function NodeHueButton({
  hue,
  onSet,
}: {
  hue?: number
  onSet: (hue: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title="标记颜色"
        aria-label="标记颜色"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          "nodrag flex size-4 items-center justify-center rounded-full border transition-transform hover:scale-110",
          hue === undefined ? "border-dashed border-muted-foreground/50" : "border-transparent"
        )}
        style={hue !== undefined ? { backgroundColor: hueDot(hue) } : undefined}
      >
        {hue === undefined && <Palette className="size-2.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="nodrag absolute right-0 top-5 z-30 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <HuePicker
            value={hue}
            onChange={(h) => {
              onSet(h)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
