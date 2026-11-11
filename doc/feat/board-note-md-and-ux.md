# 便签 Markdown 渲染 · 执行中边动画 · 整边可拖连线 · 画板宽度可调

## 背景

四项体验问题，都影响日常使用手感：

1. **便签不能渲染 Markdown**：模型输出常带标题/列表/代码，便签只显示原始符号。
2. **执行时看不出哪条线在跑**：多线任务运行时完全无反馈。
3. **必须精确拖到小圆点才能连线**：手柄只有 7px，很难命中。
4. **画板宽度固定**：右栏固定 46%，长文本与复杂图都不够用。

## 1. 便签 Markdown 渲染

### 方案：渲染态 + 编辑态双模式

- **默认渲染态**：用项目已有 `src/components/markdown.tsx` 渲染，与对话正文样式一致
- **点击进入编辑态**：显示 textarea，内容为原文
- 编辑态失焦 / `Esc` / 点「完成」→ 回到渲染态
- 空内容时显示占位提示，点击即进入编辑态

**关键约束**：编辑态必须可选中文本、可输入，不能被画布拖拽抢走事件（加 `nodrag`）。
渲染态的链接与外链也要 `nodrag`，否则点击链接会触发拖动。

### 为什么不直接 contentEditable

Markdown 源码与渲染结果之间需要来回转换，contentEditable 很难保证一致性
（粘贴、列表缩进都会破坏）。双模式最简单可靠。

## 2. 执行中边动画

### 方案

`runningEdgeIds: string[]` 从 store 传出，命中的边加 `board-edge-executing` 类：

- 虚线 + `stroke-dashoffset` 动画（沿路径流动），直观表达"正在传输"
- 颜色取该边的 `hue`（有则用），否则主题色
- 同时给起点节点加一个轻微脉冲，提示"材料正在被取用"

现在只支持单线执行与任务串行执行，所以**同一时刻最多一条边在跑**，
但接口按数组设计，为将来并发留余地。

## 3. 整边可拖连线

### 现状

节点四向各有一组 7px 的 source/target 手柄，必须精确命中才能拖出线。

### 方案

1. **`connectionMode: Loose`**：允许 source→source、target→target 连接，
   不要求方向匹配，拖拽成功率高得多。
2. **手柄热区放大**：手柄本身视觉仍是 7px 小点，但用一个透明伪元素把可点区域
   扩到约 24px；并在节点四条边各铺一条透明热区（`source`），
   从边的任意位置按下即可拉线，不再依赖那个点。
3. 热区必须不遮挡节点内容交互：只在边沿约 10px 内生效，且 `pointer-events` 
   在内容区之前被内容层覆盖。

**取舍**：整条边都变成拉线起点后，靠近边缘的点击可能被解释为"开始拉线"而非"选中节点"。
用 `nodeDragThreshold` 与"必须移动超过阈值才成线"来缓解；点击（无位移）仍选中节点。

## 4. 画板宽度可调

- 画板与对话区之间加一条可拖拽分隔条（6px，hover 高亮）
- 拖拽调整画板宽度，范围 `[360, 900]`，且不超过窗口 70%
- 宽度存 `localStorage`（独立于 ChatState，属于纯 UI 偏好）
- 双击分隔条 → 回到默认宽度
- 顺带加「最大化画板」按钮：一键切到上限宽度

## 校验方式

`scripts/test-board.cjs` 新增：

- `noteRendersMarkdown`：便签含 `## 标题` 时渲染出 `h2`，而非显示原始符号
- `noteEditMode`：点击进入编辑态，编辑后失焦回到渲染态且内容已保存
- `edgeExecutingAnimation`：执行期间该边带 `board-edge-executing` 类
- `connectFromEdges`：从节点边沿（非手柄点）拖动也能建立连线
- `boardWidthResize`：拖动分隔条改变宽度并持久化；有最大值按钮

## 实现与校验结果

### 落地情况

| 设计点 | 实现位置 |
|---|---|
| 便签 Markdown 渲染 / 编辑双模式 | `board-canvas.tsx::NoteNode` |
| 执行中边动画 | `index.css` `.board-edge-executing` + `InnerFlow` 的 `runningEdgeIds` |
| Loose 连接 + 手柄热区放大 | `ReactFlow connectionMode` + `.board-handle::after` |
| 画板宽度拖拽 + 最大化 | `App.tsx`（`data-board-resizer`）与 `BoardPanel` 的最大化按钮 |

### 与设计的偏差（重要）

**放弃了"节点任意边沿都能起线"的做法。**
原设计打算沿四条边铺透明热区手柄，实现后发现：热区一旦放开 `pointer-events`，
就会把节点的点击与拖动一起抢走，导致 `dragPersistsPosition`、
`dragFollowsPointerMidway` 等用例直接失败。

最终方案改为：**保留四向手柄，用 CSS `::after` 把命中区从 7px 扩到约 26px**，
配合 `connectionMode: Loose`（不要求 source→target 方向匹配）。
这样既不用精确对准小圆点，也不影响节点拖动。

对应地，用例 `connectFromEdges` 的断言从「从边沿起线」改为
「偏离手柄中心约 8px 仍能起线」，如实反映实现能力。

### 校验

- `scripts/test-board.cjs`：42 个用例全部通过，本 feat 新增 5 个：
  `noteRendersMarkdown`、`noteEditMode`、`edgeExecutingAnimation`、
  `connectFromEdges`、`boardWidthResize`、`boardMaximize`
- `scripts/test-quick-ask.cjs`：11 个通过（无回归）
- `npm run build`、`npx tsc -b` 通过，新增代码 lint 0 告警

### 已知限制

1. 拉线仍需从节点四边的手柄附近开始（命中区 26px），不是整条边。
   若将来要做"任意位置起线"，需要自定义 `onPointerDown` 判断而非依赖 Handle。
2. 画板宽度上限 900px 且不超过窗口 70%，避免对话区被挤没。
3. 执行动画只覆盖正在执行的边；当前串行执行，故同时最多一条。
