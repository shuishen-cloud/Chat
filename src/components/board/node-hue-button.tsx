import { useState } from "react"
import { Palette } from "lucide-react"
import { HuePicker } from "@/components/hue-picker"
import { FloatingLayer } from "@/components/ui/floating-layer"
import { hueDot } from "@/lib/hue"
import { cn } from "@/lib/utils"

/**
 * 节点卡片上的颜色入口：一个小色点，点开即选。
 *
 * 未标记时显示为虚线空心圆，与已标记的实心色点区分开；
 * `nodrag` 类确保在 React Flow 里点它不会顺带拖动卡片。
 *
 * 色板列表纵向单列，且必须 portal 到 body：卡片是 overflow-hidden 的，
 * 弹层留在卡片内时只要卡片不够高就会被裁掉（矮卡片上几乎只能看到第一个色点）。
 */
export function NodeHueButton({
  hue,
  onSet,
}: {
  hue?: number
  onSet: (hue: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <div className="relative shrink-0">
      <button
        ref={setAnchor}
        type="button"
        title="标记颜色"
        aria-label="标记颜色"
        aria-expanded={open}
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
      <FloatingLayer anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <HuePicker
          value={hue}
          layout="column"
          onChange={(h) => {
            onSet(h)
            setOpen(false)
          }}
        />
      </FloatingLayer>
    </div>
  )
}
