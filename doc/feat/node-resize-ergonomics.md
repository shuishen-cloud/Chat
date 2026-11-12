# 节点缩放手柄放大命中区：解决调整尺寸难以触发

## 背景

画板节点可以拖右下角改尺寸，但实际操作很难抓住手柄——要么拖成了移动节点，
要么光标差几像素就拉不动。

### 实测数据

选中一个 message 节点后量测 `.react-flow__resize-control.handle`：

| 量 | 值 |
|---|---|
| 手柄视觉尺寸 | 8 × 8 px（`!size-2`） |
| 手柄数量 | 4（仅四角） |
| 中心 ±10px 网格命中率 | **15 / 121 ≈ 12%** |
| 手柄被裁剪 | 是（卡片 `overflow-hidden`） |

三条并存的原因：

1. **手柄只有 8×8px。** 这是 `NodeResizer` 的 `handleClassName="!size-2"`
   主动覆盖出来的值（React Flow 默认 5px，项目已放大到 8px，仍远小于舒适点击区）。
   人手指/触控板很难稳定落在 8px 内。
2. **只有四角手柄可用，边中点形同虚设。** React Flow 其实会渲染 8 个手柄
   （4 角 + 4 边中点），但 `handle.left/right/top/bottom` 用
   `left:50%; top:100%` 之类定位后同样只有 8px 大，叠在边框线上几乎抓不到。
   结果是：**想单独改宽或单独改高，必须精准抓角斜向拖**，否则宽高一起变。
3. **被卡片 `overflow-hidden` 裁掉一部分。** 手柄以 `translate: -50% -50%`
   居中在节点边界上，一半探出卡片外，被裁掉后可见与可点区域都更小。

## 设计

### 一、扩命中区，不放大视觉

与项目里已解决过的连线手柄问题（`.board-handle` 用 `::after` 把 7px 视觉点
扩到约 26px 命中区）保持**同一套思路**：视觉保持小巧不喧宾夺主，命中区放大。

- **四角 8 个手柄全部保留**，视觉仍是 8×8px 小方块；
- 用 `::after { inset: -8px }` 把每个手柄的命中区扩到 **24×24px**；
- 命中区必须 `pointer-events: all`（React Flow 给手柄设了 `pointer-events: all`，
  `::after` 继承父元素命中行为，需要显式确保）。

### 二、边中点手柄单独加长条热区

四边中点手柄的 `::after` 只扩成 24×24 方块，落在边中间一个小点。为了让
"拉宽/拉高"整条边都能触发，再给 `.line` 加透明热区：

```css
.board-resizer-line.left, .board-resizer-line.right  { width: 10px; }
.board-resizer-line.top,  .board-resizer-line.bottom { height: 10px; }
```

注意 `line` 元素在 React Flow 里默认是 1px 边框线，把它加宽成 10px 后
光标（`ew-resize` / `ns-resize`）在整条边上都能命中。**这正好解决了
「单独改宽/改高要抓角」的痛点**。

### 三、避免误触节点拖动

`NodeResizer` 生成的手柄已自带 `nodrag` 类，但 `::after` 扩出的区域不在元素
命中区域内——与项目里连线热区的坑一致（`index.css` 注释已记录："伪元素不在
元素命中区域内，React Flow 的 pointerdown 收不到"）。

因此扩区不能用"伪元素悬空在整个环外"的做法，必须保证 `::after` 是**手柄
自身的一部分**：`::after` 作为手柄的子盒子，`pointer-events` 由手柄继承，
命中后事件目标是手柄本身，`nodrag` 生效，不会触发节点拖动。

同时把 `nodeDragThreshold` 从 2px 提到 3px，给"只是想点一下"留更宽容错。

## 数据模型

无持久化结构变化。仅：

```ts
// CSS 约定
.board-resizer-handle  // 8 个手柄（4 角 + 4 边中点），视觉 8px，命中 24px
.board-resizer-line    // 四条边，宽/高 10px 的可拖热区
```

`NodeResizer` 参数变化：`handleClassName` / `lineClassName` 换成上述类；
`minWidth` / `minHeight` 保持 180/80（message）与 140/80（note）不变。

## 接口 / 日志 / 兜底

- **API**：无对外接口变化。
- **日志**：无后端日志。
- **兜底**：
  - 扩区纯 CSS，若 `::after` 被其他父级 `overflow` 裁掉则退化为原 8px 手柄，
    **功能不失效**，只是不如之前好点；
  - 测试用 `elementFromPoint` 采样断言命中率，而不是只比对 `boundingBox`——
    后者在元素被裁剪或遮挡时仍为真，会漏掉"看得见点不到"的情况。

## 校验方式

Playwright 用例 `nodeResizeHandleReachable`：

1. 选中节点，断言 `.react-flow__resize-control.handle` 共 **8 个**；
2. 对每个手柄在中心 ±10px 网格采样 `elementFromPoint`，命中率须 **> 60%**
   （修复前实测约 12%）；
3. 断言存在边中点手柄可单独改宽：拖右边中点 → 宽度增加、高度不变；
4. 拖底边中点 → 高度增加、宽度不变；
5. 刷新页面确认尺寸已持久化。

回归：`cases.boardWidthResize` / `cases.dragPersistsPosition` 不得变红
（放大热区不能反而抢走节点拖动）。
