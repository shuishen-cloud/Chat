/**
 * 颜色标记工具。
 *
 * 延续项目已有的 hue 建模（见 types.ts 的 TAG_HUES / Tag.hue），
 * 用色相 + 明度派生各种用途的颜色，不引入第三方色板库。
 *
 * 关键点：暗色主题不能复用浅色的高亮度值，否则会刺眼过曝。
 * 所有取色函数都必须同时给出 dark 变体。
 */

/** 预设色相：8 色，覆盖常见分类需求且互相可辨 */
export const HUE_PRESETS = [45, 20, 150, 200, 240, 280, 320, 100] as const

export type HuePreset = (typeof HUE_PRESETS)[number]

/**
 * 淡背景色（用于行底色、卡片底、标签底色）。
 * 浅色取高明度低饱和，暗色取低明度，保证与前景文字有足够对比。
 */
export function hueBg(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 32% 16%)` : `hsl(${hue} 85% 94%)`
}

/** 边框 / 描边色：比背景更饱和，暗色下略提亮才看得见 */
export function hueBorder(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 45% 34%)` : `hsl(${hue} 62% 76%)`
}

/** 实心色点：小面积使用，两套主题都用中高明度 */
export function hueDot(hue: number): string {
  return `hsl(${hue} 65% 52%)`
}

/** 压在淡背景上的文字色：浅色用低明度高饱和，暗色用高明度 */
export function hueText(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 70% 82%)` : `hsl(${hue} 55% 30%)`
}

/** 连线主色：需要足够醒目，暗色下略微提亮 */
export function hueStroke(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 60% 62%)` : `hsl(${hue} 58% 48%)`
}

/**
 * 生成用于 inline style 的一组颜色。
 * 传 undefined 时返回空对象，调用方据此回退默认样式。
 */
export function hueStyle(
  hue: number | undefined,
  dark: boolean,
  kind: "bg" | "border" | "text"
): Record<string, string> {
  if (hue === undefined) return {}
  switch (kind) {
    case "bg":
      return { backgroundColor: hueBg(hue, dark) }
    case "border":
      return { borderColor: hueBorder(hue, dark) }
    case "text":
      return { color: hueText(hue, dark) }
  }
}
