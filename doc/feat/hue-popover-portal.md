# 色板弹层改用 Portal 定位并纵向单列

## 背景

画板节点卡片头部有一个小色点按钮（`NodeHueButton`），点开弹出 `HuePicker` 选色。
实际点击后只看到第一个色点，其余全被切掉——节点越矮，可见的色点越少。

### 复现与实测

造一个内容只有一行的 message 节点（卡片高度约 70px），点开色板后量测：

| 量 | 值 |
|---|---|
| 卡片 rect 高 | 70.5 px |
| 弹层 rect 高 | 226 px |
| 弹层超出卡片底部 | 184.5 px |

截图复核：8 个色点只露出最上面 1 个。

### 根因：`overflow-hidden` 裁剪，与高度和缩放都相关

弹层是节点内部的绝对定位元素：

```tsx
// src/components/board/node-hue-button.tsx
<div className="relative shrink-0">
  <button … />
  {open && <div className="nodrag absolute right-0 top-5 z-30 …">…</div>}
</div>
```

`absolute` 只决定**位置参考系**（就近的 `relative` 祖先）。**裁剪**由祖先链上
谁设了 `overflow` 决定。而卡片最外层（`MessageNode` / `NoteNode`）是：

```
"flex flex-col overflow-hidden rounded-xl border …"
```

于是三条互相叠加的路径都会切掉弹层：

1. **未设定尺寸的卡片**：高度由内容撑开（正文 `max-h-[132px]`），弹层从头部
   向下展开，超出卡片底边即被裁。
2. **设定了尺寸的卡片**：`style` 给 `width/height: 100%`，正文区是
   `flex-1 overflow-y-auto`，会吃掉全部剩余高度，卡片对外仍是一个封闭盒子，
   弹层照样出不去。
3. **画布缩放不救场**：`minZoom 0.2` 让视觉上"画布很大、周围都是空白"，
   但裁剪是按**布局像素**算的，与 `transform: scale()` 无关；缩得再小，
   超出卡片布局边界的部分依旧不绘制。

另外 `z-30` 不是逃生手段：`z-index` 只决定同一层叠上下文内的绘制顺序，
管不了溢出裁剪。要逃离裁剪，必须把弹层渲染到裁剪容器**之外**的层叠根上。

## 设计

### 一、新增 `FloatingLayer`：Portal 到 body + fixed 定位

```tsx
// src/components/ui/floating-layer.tsx
export function FloatingLayer({
  anchor,      // 参照元素（色点按钮）
  open,
  onClose,     // 点外部 / Esc
  align = "end",
  children,
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  align?: "start" | "end"
  children: React.ReactNode
}): React.ReactNode
```

要点：

- `createPortal` 到 `document.body`，脱离节点的 `overflow-hidden` 与
  React Flow 的 `transform` 缩放上下文。
- 用 `anchor.getBoundingClientRect()` 计算 `position: fixed` 坐标，
  水平按 `align` 贴左或贴右。
- **自动翻转（flip）**：默认向下展开；若下方剩余空间放不下弹层，改为向上展开。
  这解决"节点贴着画布底边"的情况——只做 Portal 不翻转的话，弹层会跑到视口外。
- **重算时机**：打开时算一次；`window` 的 `resize`、画布 `scroll`（React Flow
  平移会触发 pan 而非滚动，额外监听 `wheel` 与 `pointermove`/拖拽结束）时重算，
  避免平移后弹层"飘"在原处。
- 定位信息拿到之前（首帧）不渲染，避免闪一下 `0,0`。

### 二、`HuePicker` 支持纵向单列

需求要求"点击颜色之后纵向显示颜色列表"：

```tsx
export function HuePicker({ value, onChange, layout = "row", className })
```

- `layout="row"`：现状的 `flex flex-wrap`（边编辑器、会话菜单沿用，横向更省空间）。
- `layout="column"`：`flex flex-col`，8 个预设色 + "无颜色"纵向单列。

节点色点按钮改用 `column`；配合 flip，弹层高 226px 左右，在 900px 视口内
上下都有足够空间。

### 三、弹层关闭语义

- 选中颜色后立即关闭（沿用现状）；
- 点击弹层外部关闭；
- `Esc` 关闭。

## 数据模型

无持久化数据结构变化。新增：

```ts
type HuePickerLayout = "row" | "column"

// FloatingLayer 内部状态
type Placement = { top: number; left: number; side: "top" | "bottom" }
```

## 接口 / 日志 / 兜底

- **API**：`FloatingLayer({ anchor, open, onClose, align, children })`；
  `HuePicker({ value, onChange, layout })`。
- **日志**：无后端日志。开发模式下锚点元素已卸载则不渲染浮层。
- **兜底**：
  - 拿不到锚点 `rect` → 不渲染，避免定位到视口左上角；
  - `document.body` 不可用（SSR/测试环境）→ 退化为锚点父容器内联渲染；
  - 点击外部 / `Esc` 均可关闭，防止浮层残留挡住画布操作。

## 校验方式

Playwright 用例 `huePopoverNotClipped`：

1. 造一个单行内容的 message 节点（卡片高度 ~70px），进入画板并点开色板；
2. 断言 9 个色点按钮（`[data-hue]` + `[data-hue-clear]`）全部存在；
3. 对每个按钮取其 `boundingBox`，用 `document.elementFromPoint(中心)` 断言
   命中的元素在按钮内部——被 `overflow-hidden` 裁掉的部分 `elementFromPoint`
   拿不到，能精准证明"未被裁剪"；
4. 断言弹层矩形有一条边落在卡片矩形之外（说明确实脱出了卡片边界）；
5. 点选一个颜色，确认 `hue` 仍能正常落库（回归原有选色功能）。

顺带回归：`cases.colorMarks` / `cases.colorConversation` / 边提示词配色用例
不能因为 `HuePicker` 加参数而变红。
