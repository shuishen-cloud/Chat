# 连线长按悬浮编辑：线条文字 + 线条颜色 + 即执行（edge-inline-editor）

## 问题

画板 v2 把「点线 → 打开悬浮编辑器」这条路走通了，但编辑体验有三处硬伤：

| 现象 | 根因 |
|---|---|
| 悬浮窗位置飘，第二次点线永远出现在屏幕中部 | 画布把 `onEdgeClick(edgeId, anchor)` 的 anchor 丢掉（`index.tsx` 只转 id），panel 用 `prev.x===0 && prev.y===0 ? 屏幕中部 : prev` 兜底，于是只有「第一次」能拿到坐标 |
| 线条上没有可读的名字，只有提示词徽章 | `BoardEdge.label` 字段一直存在却从没被写；可见文本一律来自 `prompt`，且只有 `flow` 边才有 |
| 「改为仅联系 / 改为可执行 / 禁用 / 启用」四个按钮表达同一件事 | 「这条线会不会被执行」被拆成 `kind` 与 `enabled` 两个正交字段，用户要在两个概念间做心算 |
| 线色与提示词色两套取色器 | `hue` 画线、`promptHue` 画徽章；实际使用时几乎总是设成同一个值 |

另外：入口只有「点击」，在触屏与大画布上很容易误触另一条线（线之间常常挨得很近）。

## 目标

1. **长按线 → 悬浮窗贴着按下点出现**（不是屏幕中部），短按仍可打开编辑器。
2. 悬浮窗里能填 **线条文字**（画在线上，任何 kind 都显示）与 **执行提示词**（送模型的指令）。
3. 悬浮窗里能切 **即执行模式**：开启后点击这条线就直接执行，等于把「线」变成「按钮」。
4. 一个取色器管 **线条颜色**，线、徽章、文字同步染色。

## 规范

### 一、入口：长按 + 短按

| 操作 | 触发 | 结果 |
|---|---|---|
| 长按线 ≥ 500ms（位移 ≤ 6px） | `pointerdown` 起计时 | 打开悬浮编辑器，锚点 = 按下点屏幕坐标 |
| 短按（抬起时未满 500ms） | `pointerup` | 同现状：打开编辑器（选区模式下改为选边） |
| 长按过程中位移 > 6px | `pointermove` | 取消计时，**不打开**（当作误触/画布拖动） |
| Enter / Ctrl+Enter | 选中边时 | 执行该边（既有行为保留） |

实现要点：`useLongPress` 是纯计时逻辑（无 DOM 之外的依赖），
把 `pointerdown/up/cancel/move` 作为回调交给使用方挂载；
定时器在抬起、取消、位移超阈值、组件卸载时清理。
触屏长按会触发 `contextmenu`，在命中层上 `preventDefault` 吃掉。

### 二、命中的位置

React Flow 的 `edge.` 元素本身极细（1.8px 描边），直接在上面挂
pointer 事件命中率很低。用 `EdgeLabelRenderer` 在线的中点放一个
**透明命中块**（约 44×22，可点可长按），`pointer-events: all`：

- `onPointerDown` 记录屏幕坐标 → 长按计时；
- 命中块不参与 `nodrag/nopan`，因此长按期间不影响画布平移（抬手即结束）。

边本身的 `onEdgeClick` 保留作为键盘/无障碍入口与兼容路径。

### 三、悬浮窗内容

```
┌───────────────────────────────┐
│ ⚡ 连线            [×]        │
│ 线条文字  [________________]  │  ← label，画在线上，任何 kind 都显示
│ 执行提示词 [________________] │  ← prompt，仅「即执行」开启时可用
│ 线条颜色  ● ● ● ● ● ● ● ● ⊘  │  ← hue
│ [即执行 ⟳]  [立即执行] [删除] │
└───────────────────────────────┘
```

- **线条文字**：即时写回（受控组件 + `onUpdate`），空则回落到提示词徽章；
- **执行提示词**：本地编辑，「保存」或「立即执行」时落库（沿用旧行为，避免每敲一个字都写 localStorage）；
- **线条颜色**：`hue`，线、箭头、文字、徽章底同步；
- **即执行开关**：整条边是否参与执行。
  - 关：`kind = manual`（纯视觉联系）；
  - 开：`kind = flow` + `enabled = true`，并记住「点击即执行」偏好；
  - 关闭时提示词输入禁用（没有执行语义）。
- **立即执行**：仅「即执行」开启时出现。

### 四、数据模型

沿用既有 `BoardEdge`，**不新增持久化字段类型**（`label` 早已存在），
只新增一个 UI 偏好与两个 store 方法：

```ts
// store 新增
setEdgeLabel(edgeId: string, label: string): void      // 写回 lines 文字
setEdgeInstant(edgeId: string, on: boolean): void      // kind + enabled 一起切
```

「点击即执行」的偏好存在 UI 侧而非 doc：
它描述的是**用户此刻的操作习惯**，不是这块画板的内容，
重载后保留（localStorage 单独一个键 `board.instantRun`），
但不进入 `BoardDoc`，因此不影响 `toFlow ∘ fromFlow ≡ id` 的可逆性。

`promptHue` 字段**保留**（旧数据仍可渲染徽章色），UI 不再写它；
渲染优先级：`hue` → `promptHue` → 主题色。

### 五、颜色渲染

`decorateEdge` 不再靠 class 决定颜色，而是给边挂 CSS 变量：

```
style: { "--board-edge-hue": String(hue), "--board-edge-hue-dark": dark ? "1" : "0" }
```

CSS 里：

```css
.board-edge-tinted .react-flow__edge-path { stroke: var(--board-edge-stroke); }
```

`--board-edge-stroke` / `--board-edge-chip-bg` / `--board-edge-chip-fg`
在 `decorateEdge` 里用 `hueStroke/hueBg/hueText` 现算并写进 style，
主题切换（dark）经 `dark` 参数参与计算——与 `lib/hue.ts` 的既有约定一致：
暗色不复用浅色值。

## 校验方式

纯函数（`node --test scripts/test-board-v2.ts`）：

- `longPressFiresAfterDelay`：500ms 内触发一次；
- `longPressCancelledByMove`：位移 > 6px 不触发；
- `longPressCancelledByUp`：抬起早于阈值不触发；
- `instantModeTogglesKindAndEnabled`：`setEdgeInstant` 的语义（flow+enabled / manual）；
- `decorateEdgeUsesLabelThenPrompt`：有 label 显示 label，否则显示提示词徽章；
- `decorateEdgeHueFallsBack`：`hue` 缺失时回落 `promptHue`，都缺省回落主题色。

UI（`scripts/test-board.cjs`）：

- `edgeLongPressOpensNearPressPoint`：长按线 → 悬浮窗出现，且其位置距按下点 < 400px（不是屏幕中点兜底）；
- `edgeLabelPersists`：在悬浮窗里填「线条文字」→ 线上出现该文字、落库 `boardEdges[0].label`；
- `edgeInstantRunClick`：开启即执行后，点击该线（非长按）直接发出请求并写回终点。

## 实现与校验结果

（收尾阶段补写）
