# 画板颜色标记 · 单线执行 · 思考开关 · 历史美化

## 背景

四项独立的体验补充，共同点是都围绕"组织信息时的可辨识度与操作效率"：

1. **颜色标记**（强需求）：节点、连线、侧边栏会话都要能标色，便于一眼区分。
2. **单线执行**：任务只是可选项，多数时候只想跑某一条线。
3. **思考开关**：能控制是否让模型输出思维链。
4. **历史美化**：当前节点历史是裸文本堆叠，难以阅读。

## 1. 颜色标记

### 方案：固定色相预设（复用项目已有建模）

项目里 `Tag` 已用 `hue: number` 建模，配色由
`hsl(${hue} 85% 92%)` 这类表达式生成。本 feat **沿用同一套思路**，不引入第三方色板库。

```ts
// src/lib/hue.ts
export const HUE_PRESETS = [45, 200, 280, 150, 20, 320, 240, 100] as const

export type HueTarget = "node" | "edge" | "conversation"

/** 淡背景（标签/行底色） */
export function hueBg(hue: number, dark: boolean): string
/** 边框/强调色 */
export function hueBorder(hue: number, dark: boolean): string
/** 实心色点 */
export function hueDot(hue: number): string
/** 文字色（压在淡背景上） */
export function hueText(hue: number, dark: boolean): string
```

**关键约束**：现有代码只写了浅色亮度（`85% 92%`），暗色主题下会过曝。
本 feat 的 `hueBg` 必须同时处理 dark 分支（降低亮度、提高饱和度对比），
这是现有 `favorites-panel.tsx` 的已知缺陷，新工具不得重蹈。

### 数据模型

```ts
interface BoardNode  { hue?: number }
interface BoardEdge  { hue?: number }
interface Conversation { hue?: number }
```

三者均为可选，**旧数据无需迁移**；`undefined` 表示"无颜色"，渲染回退默认样式。

### 交互

共享组件 `HuePicker`：8 个预设色点 + "无颜色"。

- 节点：卡片头部加小色点按钮
- 连线：边编辑器里加一行色点
- 会话：侧边栏会话项右键菜单/更多菜单里加"标记颜色"，行首显示色点

## 2. 单线执行

### 设计

把现有 `runTask` 里的"逐边执行"抽成 `runEdge(edgeId)`，`runTask` 改为循环调用它。
**两套入口共用同一份执行逻辑**，避免行为分叉。

### 入口

- 边编辑器里加「立即执行」按钮
- 键盘：选中连线后按 `Enter` 或 `Ctrl/Cmd+Enter` 执行该线
  - 仅在焦点不在输入框时生效（判断 `document.activeElement` 是否为 input/textarea）
- 任务仍保留，作为"批量跑一组线"的可选方式

### 语义

单线执行与任务执行单条线的行为完全一致：
只读该线的起点材料 + 边提示词 → 请求 → 结果写回终点节点 → 追加历史。

## 3. 思考开关

### 前提说明

DeepSeek 官方 API 目前**没有公开的思考强度参数**，本项目此前也只是被动读取响应里的
`reasoning_content`。因此本 feat 只做**开关**，不做强度档位。

### 保守实现

- `ChatState.thinkingEnabled: boolean`，默认 `true`（保持现有行为）
- 设置对话框里给一个开关
- **关闭时不在请求体里附加任何非标参数**，仅靠界面层忽略/隐藏思维链
  - 理由：无 API Key 无法实测服务端是否接受 `thinking.disabled` 等参数，
    贸然发送可能导致整个请求被拒。宁可退化为"展示层开关"，也不能把对话打挂。
- 若将来实测确认支持，只需在 `streamChat` 里补一个字段，开关语义不变

**如实告知用户**：设置里该开关的说明文字要写明"关闭后不再展示思维链；
是否真正减少模型思考取决于服务端支持"。不做无法兑现的承诺。

## 4. 节点历史美化

### 现状

`node.runs` 直接以 `line-clamp-3` 的裸文本渲染，缺少层次：分不清时间/提示词/输出。

### 目标

每条历史呈现为一张小卡片：

```
┌────────────────────────────┐
│ 12:03:41  · 提炼核心论点  回填 │   ← 时间 + 提示词（截断）
│ ──────────────────────────  │
│ 输出正文前几行…              │   （等宽/正文分级，最多 4 行）
│ 输入：材料A（1 项）           │   ← 折叠的输入摘要
└────────────────────────────┘
```

- 失败记录用 destructive 色调 + `AlertCircle`，并可展开看错误原因
- 时间用相对/绝对格式（今天显示时分秒，跨天显示日期）
- 展开单条可看完整的提示词与输入材料
- 空历史不渲染历史区

## 校验方式

`scripts/test-board.cjs` 新增：

- `colorNode` / `colorEdge` / `colorConversation`：设置颜色并持久化，渲染出对应样式
- `hueDarkContrast`：暗色下 `hueBg` 与 `hueText` 确实返回不同亮度（防过曝回归）
- `runSingleEdge`：不建任务，直接跑一条线，结果写回终点并留历史
- `runEdgeKeyboard`：选中线按 Enter 触发执行
- `thinkingToggle`：关闭后请求体不含额外字段，且界面不显示思维链
- `historyRendering`：历史区包含时间、提示词、输入摘要三类信息

## 实现与校验结果

（收尾阶段补充）
