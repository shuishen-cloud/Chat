/**
 * 四向连接手柄。
 *
 * v1 的教训：手柄视觉 7px、::after 扩 10px、再加一条 12px 透明热区、
 * 再来一层 ConnectingSurface，四层叠在一起，导致「点不到 / 连线和拖拽打架」。
 *
 * v2 只保留**一层**：手柄本体就是 20×20 的命中盒，视觉用 ::before 画小圆点。
 * 状态机保证同一时刻只有一种交互（见 interaction/machine.ts）。
 */
import { Handle } from "@xyflow/react"

import { POSITION, SIDES, handleId } from "./handles-model"

/**
 * 八向手柄（每边一源一目标）。
 *
 * `connectionMode="loose"` 下不区分方向，但保留两套 id 是为了将来
 * 允许「同一条边指定从哪一侧出、从哪一侧入」。
 */
export function CardHandles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={`t-${side}`}
          id={handleId("t", side)}
          type="target"
          position={POSITION[side]}
          className="board2-handle board2-handle-target"
        />
      ))}
      {SIDES.map((side) => (
        <Handle
          key={`s-${side}`}
          id={handleId("s", side)}
          type="source"
          position={POSITION[side]}
          className="board2-handle board2-handle-source"
        />
      ))}
    </>
  )
}
