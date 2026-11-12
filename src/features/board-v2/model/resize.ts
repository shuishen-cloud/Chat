/**
 * 缩放几何：唯一决定「往某个方向拉，盒子怎么变」的地方。
 *
 * 这是本次重写的核心回归点：v1 里缩放不走这里，而是由 React Flow 内部算
 * x/y/width/height 再被业务 store 用旧尺寸覆盖，导致「往左拉却向右长」。
 * 现在全部收敛到一个纯函数，方向不变量可以逐条断言。
 */

export type Box = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

/** 八个方向：n=上（北）、e=右（东）… */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

/** 从方向串解析出受影响的边 */
export function dirAffects(dir: ResizeDir): { west: boolean; east: boolean; north: boolean; south: boolean } {
  return {
    west: dir.includes("w"),
    east: dir.includes("e"),
    north: dir.includes("n"),
    south: dir.includes("s"),
  }
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback
}

/**
 * 按方向与位移调整盒子。
 *
 * 不变量（测试逐条覆盖）：
 *  - west：right 恒定；east：left 恒定；north：bottom 恒定；south：top 恒定。
 *  - 达到 min 后夹紧，且**不会继续漂移**（再拉也不动）。
 *  - 只影响 x/宽 的方向不动 y/高，反之亦然。
 *  - 任何 NaN/Infinity 输入都被替换为原值，不产生 NaN 几何。
 */
export function resizeNode(box: Box, dir: ResizeDir, delta: { dx: number; dy: number }, min: Size): Box {
  const aff = dirAffects(dir)
  const dx = finite(delta.dx, 0)
  const dy = finite(delta.dy, 0)

  let { x, y, width, height } = box
  x = finite(x, 0)
  y = finite(y, 0)
  width = Math.max(0, finite(width, 0))
  height = Math.max(0, finite(height, 0))

  const right = x + width
  const bottom = y + height

  // 水平方向：west 拖左边缘（right 固定），east 拖右边缘（left 固定）
  if (aff.west && !aff.east) {
    const nextWidth = Math.max(min.width, width - dx)
    x = right - nextWidth
    width = nextWidth
  } else if (aff.east && !aff.west) {
    width = Math.max(min.width, width + dx)
  }

  // 垂直方向：north 拖上边缘（bottom 固定），south 拖下边缘（top 固定）
  if (aff.north && !aff.south) {
    const nextHeight = Math.max(min.height, height - dy)
    y = bottom - nextHeight
    height = nextHeight
  } else if (aff.south && !aff.north) {
    height = Math.max(min.height, height + dy)
  }

  return { x, y, width, height }
}
