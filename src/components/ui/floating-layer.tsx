import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/** 弹层与锚点之间的间距（px） */
const GAP = 6
/** 弹层与视口边缘至少留出的距离，避免贴边不可点 */
const MARGIN = 8

type Placement = { top: number; left: number; side: "top" | "bottom" }

/**
 * 挂在 body 上的浮层（Portal + fixed 定位）。
 *
 * 存在的理由：画板节点卡片是 `overflow-hidden` 的，节点内任何 absolute 弹层
 * 一旦超出卡片边界就会被裁掉——`z-index` 无法逃出溢出裁剪。把浮层 portal 到
 * body，既脱离节点的裁剪，也脱离 React Flow 的 transform 缩放上下文。
 *
 * 定位策略：
 *  - 水平：按 `align` 贴锚点左边缘或右边缘，并夹在视口内；
 *  - 垂直：默认向下，下方放不下就翻转到上方（flip），两边都放不下时取空间
 *    更大的一侧，仍夹在视口内。
 *
 * 重算时机：打开时、窗口 resize、任意滚动容器 scroll，以及画布平移/缩放
 * （React Flow 平移不会触发 scroll，所以额外监听 wheel 与 pointerup）。
 */
export function FloatingLayer({
  anchor,
  open,
  onClose,
  align = "end",
  className,
  children,
}: {
  /** 位置参考元素；为 null 时不渲染 */
  anchor: HTMLElement | null
  open: boolean
  /** 点击浮层外部时调用 */
  onClose: () => void
  align?: "start" | "end"
  className?: string
  children: React.ReactNode
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  /** null 表示还没量到尺寸，此时不渲染，避免闪一下左上角 */
  const [place, setPlace] = useState<Placement | null>(null)
  /** 是否已挂载到 DOM（首帧用于无条件测量） */
  const [mounted, setMounted] = useState(false)

  const measure = useCallback(() => {
    const el = layerRef.current
    if (!anchor || !el) return
    const a = anchor.getBoundingClientRect()
    // 首帧浮层宽度由内容决定，先量再定位
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = align === "end" ? a.right - w : a.left
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN))

    const below = vh - a.bottom - GAP - MARGIN
    const above = a.top - GAP - MARGIN
    // 下方能放下就向下；否则上方能放下就向上；都放不下取空间更大的一侧
    const side: "top" | "bottom" | null =
      below >= h ? "bottom" : above >= h ? "top" : below >= above ? "bottom" : "top"
    const top =
      side === "bottom"
        ? a.bottom + GAP
        : Math.max(MARGIN, a.top - GAP - h)

    setPlace({ top, left, side })
  }, [anchor, align])

  // 打开时先量尺寸再落位。
  // 依赖 mounted：首帧 ref 刚挂上还没有布局，量不到尺寸，挂载后的那次渲染再量。
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      setMounted(false)
      return
    }
    measure()
  }, [open, measure, mounted])

  // 位置随窗口与画布变化重算
  useEffect(() => {
    if (!open) return
    const onAny = () => measure()
    window.addEventListener("resize", onAny)
    window.addEventListener("scroll", onAny, true)
    window.addEventListener("wheel", onAny, { passive: true })
    window.addEventListener("pointerup", onAny)
    return () => {
      window.removeEventListener("resize", onAny)
      window.removeEventListener("scroll", onAny, true)
      window.removeEventListener("wheel", onAny)
      window.removeEventListener("pointerup", onAny)
    }
  }, [open, measure])

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (layerRef.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    // 捕获阶段监听，避免被节点上的 stopPropagation 挡住
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open, onClose, anchor])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={(el) => {
        layerRef.current = el
        if (el && !mounted) setMounted(true)
      }}
      data-floating-layer
      data-side={place?.side ?? "bottom"}
      style={
        place
          ? { top: place.top, left: place.left }
          : // 定位前先藏起来，避免可见的跳动
            { top: 0, left: 0, visibility: "hidden" }
      }
      className={cn(
        "nodrag nopan fixed z-[60] rounded-lg border border-border bg-card p-1.5 shadow-lg",
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
