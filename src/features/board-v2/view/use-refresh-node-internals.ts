/**
 * 卡片内容/尺寸变化后刷新手柄量测。
 *
 * 为什么需要：React Flow 只在节点**首次量测**时记录每个 handle 的坐标，
 * 之后卡片内容变化（展开、历史、改写、resize）导致高度变化时，handleBounds
 * 仍是旧值，连线会画到错误位置——典型表现是「线从卡片上方的空白处出发」。
 *
 * 这里在内容与尺寸变化后调用 `updateNodeInternals`，把量测刷新到最新 DOM。
 * 放在独立文件里而不是塞进 board-canvas：那是组件文件，加了 hook 会拖累
 * Fast Refresh 边界，也让画布本身更难读。
 */
import { useEffect } from "react"

import type { CardNode } from "../model/doc"

export function useRefreshNodeInternals(
  id: string,
  node: CardNode | undefined,
  updateNodeInternals: (id: string) => void
) {
  // 内容指纹：命中任何一项变化就要重新量测
  const signature = [
    node?.width,
    node?.height,
    node?.card.expanded ? "1" : "0",
    node?.card.contentOverride?.length ?? 0,
    node?.card.runs?.length ?? 0,
    node?.card.kind === "note" ? node.card.note.length : (node?.card.title?.length ?? 0),
  ].join("|")

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, signature, updateNodeInternals])
}
