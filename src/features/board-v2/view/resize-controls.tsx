/**
 * 缩放控制：八向手柄 + 四条边线。
 *
 * 只做**一件事**：把 React Flow 的拖拽手势翻译成 `resizeNode` 的调用。
 *
 * v1 的问题不是手柄本身，而是「尺寸变更写到本地、位置变更写到 store」，
 * 两边各写一半。这里改成：拖动过程中把结果直接写回 React Flow store
 * （通过 setNodes），松手时由画布的 commitGeometry 一次性落库，
 * 所以尺寸与坐标永远同源、同帧、同一次写库。
 */
import { useCallback, useRef, useState } from "react"
import { useReactFlow } from "@xyflow/react"

import { MIN_SIZE, type CardNode } from "../model/doc"
import { resizeNode, type ResizeDir } from "../model/resize"

const HANDLES: Array<{ dir: ResizeDir; className: string }> = [
  { dir: "nw", className: "left top" },
  { dir: "n", className: "center top" },
  { dir: "ne", className: "right top" },
  { dir: "e", className: "right center" },
  { dir: "se", className: "right bottom" },
  { dir: "s", className: "center bottom" },
  { dir: "sw", className: "left bottom" },
  { dir: "w", className: "left center" },
]

type DragState = {
  dir: ResizeDir
  startX: number
  startY: number
  origin: CardNode["position"] & { width: number; height: number }
} | null

/**
 * 缩放控制。
 *
 * 用原生 pointer 事件而不是 `NodeResizer`：
 * `NodeResizer` 自己在内部算 x/y/width/height 并直接写 store，
 * 我们无法插入 `resizeNode` 的方向不变量；而缩放的几何规则
 * 必须是可单独测试的纯函数（见 model/resize.ts）。
 */
export function ResizeControls({
  nodeId,
  width,
  height,
  visible,
  onCommit,
}: {
  nodeId: string
  width: number
  height: number
  visible: boolean
  /** 松手时落库（此时 store 已是最终几何） */
  onCommit: () => void
}) {
  const { getZoom, setNodes } = useReactFlow()
  const dragRef = useRef<DragState>(null)
  const [active, setActive] = useState(false)

  const onPointerDown = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const zoom = getZoom() || 1
      dragRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origin: { x: 0, y: 0, width, height },
      }
      setActive(true)

      // 当前位置从 store 取，避免依赖外部传入的坐标
      setNodes((nodes) => {
        const node = nodes.find((n) => n.id === nodeId)
        if (node && dragRef.current) {
          dragRef.current.origin = {
            x: node.position.x,
            y: node.position.y,
            width: node.width ?? width,
            height: node.height ?? height,
          }
        }
        return nodes
      })

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        // 屏幕位移 → 画布位移：必须除以缩放比，否则 zoom 后手柄跟手不一致
        const dx = (ev.clientX - drag.startX) / zoom
        const dy = (ev.clientY - drag.startY) / zoom
        const next = resizeNode(drag.origin, drag.dir, { dx, dy }, MIN_SIZE)
        setNodes((nodes) =>
          nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  position: { x: next.x, y: next.y },
                  width: next.width,
                  height: next.height,
                  style: { width: next.width, height: next.height },
                  data: { ...n.data, explicitSize: true },
                }
              : n
          )
        )
      }

      const onUp = () => {
        dragRef.current = null
        setActive(false)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        onCommit()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [getZoom, nodeId, width, height, setNodes, onCommit]
  )

  if (!visible) return null

  return (
    <>
      {HANDLES.map(({ dir, className }) => (
        <div
          key={dir}
          role="presentation"
          data-resize-dir={dir}
          onPointerDown={onPointerDown(dir)}
          className={`board2-resize-handle nodrag ${className}${
            active ? " board2-resize-active" : ""
          }`}
        />
      ))}
      {/* 四条边的命中线：整边可拖，用于只改宽或只改高 */}
      {(["top", "bottom"] as const).map((side) => (
        <div
          key={`line-${side}`}
          role="presentation"
          data-resize-dir={side === "top" ? "n" : "s"}
          onPointerDown={onPointerDown(side === "top" ? "n" : "s")}
          className={`board2-resize-line board2-resize-${side} nodrag`}
        />
      ))}
      {(["left", "right"] as const).map((side) => (
        <div
          key={`line-${side}`}
          role="presentation"
          data-resize-dir={side === "left" ? "w" : "e"}
          onPointerDown={onPointerDown(side === "left" ? "w" : "e")}
          className={`board2-resize-line board2-resize-${side} nodrag`}
        />
      ))}
    </>
  )
}
