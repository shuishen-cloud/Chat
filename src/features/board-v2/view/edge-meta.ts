/**
 * 连线的可见文本与配色（纯函数）。
 *
 * 规则集中在这里，是为了让「线上显示什么、染成什么色」有唯一出处：
 *  - 文本：`label`（线条文字）优先，其次 `prompt`（执行提示词），都没有就不显示；
 *  - 颜色：`hue` 优先，缺失时回落旧的 `promptHue`（兼容老数据），都缺失用主题色。
 *
 * 不 import React、不碰 DOM。
 */
import { hueBg, hueText, hueStroke } from "../../../lib/hue.ts"

import type { BoardEdgeDoc } from "../model/doc"

/** 线上要显示的文字：没有可显示内容时返回 undefined */
export function edgeTextOf(edge: Pick<BoardEdgeDoc, "label" | "prompt" | "kind">): string | undefined {
  const label = edge.label?.trim()
  if (label) return label
  const prompt = edge.prompt?.trim()
  if (prompt) return prompt
  return undefined
}

/** 取色来源：线条色优先，其次提示词色，都没有返回 undefined */
export function edgeHueOf(edge: Pick<BoardEdgeDoc, "hue" | "promptHue">): number | undefined {
  return edge.hue ?? edge.promptHue
}

export type EdgePalette = {
  /** 连线描边 */
  stroke: string
  /** 文字徽章底色 */
  chipBg: string
  /** 文字徽章文字色 */
  chipFg: string
}

/**
 * 连线配色。`hue` 缺省时返回 null，由 CSS 回落主题色。
 *
 * 徽章底色用 hueBg：它与画布背景同族但略微偏移，保证文字可读；
 * 暗色主题走 hue.ts 的暗色分支（不复用浅色值，避免过曝）。
 */
export function edgePaletteOf(
  edge: Pick<BoardEdgeDoc, "hue" | "promptHue">,
  dark: boolean
): EdgePalette | null {
  const hue = edgeHueOf(edge)
  if (hue === undefined) return null
  return {
    stroke: hueStroke(hue, dark),
    chipBg: hueBg(hue, dark),
    chipFg: hueText(hue, dark),
  }
}
