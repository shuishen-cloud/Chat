/**
 * 手柄的几何常量与 id 解析。
 *
 * 与组件分开，保证 handles.tsx 只导出组件（Fast Refresh 要求）。
 */
import { Position } from "@xyflow/react"

export const SIDES = ["top", "right", "bottom", "left"] as const
export type Side = (typeof SIDES)[number]

export const POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** 手柄 id：s- = 源（拉出），t- = 目标（落入） */
export function handleId(kind: "s" | "t", side: Side): string {
  return `${kind}-${side}`
}

export function parseHandle(
  id: string | null | undefined
): { kind: "s" | "t"; side: Side } | null {
  if (!id) return null
  const [kind, side] = id.split("-")
  if ((kind !== "s" && kind !== "t") || !SIDES.includes(side as Side)) return null
  return { kind, side: side as Side }
}
