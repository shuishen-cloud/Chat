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

### 落地情况

| 设计点 | 实现位置 |
|---|---|
| 长按判定（500ms / 6px 容差 / 卸载清理） | `view/long-press.ts::LongPressTracker` |
| 连线文字与取色的纯判定 | `view/edge-meta.ts::edgeTextOf` / `edgeHueOf` / `edgePaletteOf` |
| 整条线可长按的热区 | `view/board-canvas.tsx` 自定义边 `board`：26px 透明描边 + 中点徽章 |
| 悬浮窗（线条文字 / 提示词 / 单取色器 / 即执行开关） | `components/board/edge-editor.tsx` |
| 写回线条文字 | `use-chat-store.ts::setEdgeLabel`（空串删字段，不留 `label: ""`） |
| 即执行开关 | `use-chat-store.ts::setEdgeInstant`（on: flow+enabled / off: manual 且清 enabled） |
| 颜色统一注入 | `model/map.ts::decorateEdge` 写 CSS 变量 `--board-edge-*` |
| 手势语义落地 | `board-canvas.tsx`：`onEdgeRun`（点击）/ `onEdgeClick`（长按） |
| 手柄量测偏移修复 | `src/index.css` 的 `.board2-handle` 回到 1×1 + 伪元素命中区 |

### 与设计的偏差

**「点击即执行」从「线级开关 + 画布级偏好」改为「点击就是执行」。**
设计原写「即执行是每条线的一个开关，开启后点击线直接执行」，实现过程中发现
用户的心智模型更简单：**点击 = 干活、长按 = 改这条线**。于是：

- 线级的「即执行」开关保留，它表达的是「这条线是否参与执行」（kind + enabled）；
- 画布级 `instantRun` 偏好被**删除**（点击执行已是默认行为，那个开关没有意义了）；
- 不可执行的线被点击时给一条 toast 提示，引导去长按开设置。

### 三个必须记下来的坑

1. **手柄做成 20×20 命中盒 → 所有连线端点偏移 10px。**
   React Flow 量测手柄取的是元素**左上角**当端点，只有尺寸趋近 0 时才等于视觉中心。
   顶部手柄因此算出 `y=-10`，线被画到卡片上方空白处，路径退化后点击/长按全部点不中。
   修法：手柄元素 1×1，视觉圆点与 22×22 命中区都用伪元素画（伪元素不参与量测）。

2. **长按热区只放在线中点 → 按线的其它位置完全没反应。**
   第一版把手势挂在 `EdgeLabelRenderer` 的中点徽章上（约 42×23），
   线有几百像素长，用户在别处按下去事件根本到不了。
   修法：沿整条贝塞尔路径铺 26px 宽透明描边（`pointer-events: stroke`）。

3. **点击一次线发出两次执行请求。**
   命中块的 `pointerup` 与 React Flow 的 `onEdgeClick` 是同一手势的两条路径。
   修法：命中块处理手势后记 `lastHandledAtRef`，兜底路径 400ms 内直接 return。

### 校验

纯函数（`node --test scripts/test-board-v2-model.ts`，20 用例全通过）：

- `longPressFiresAfterDelay` / `longPressCancelledByMove` / `longPressCancelledByUp`
  / `longPress: dispose 后静默` —— 长按的四种结局；
- `连线文字：label 优先，其次 prompt` / `取色回退` / `暗色不复用浅色值`。

UI（`scripts/test-board.cjs`，本次新增/改写）：

| 用例 | 验证点 |
|---|---|
| `edgeLongPressOpensNearPressPoint` | 长按 → 悬浮窗出现在按下点附近（非屏幕中部兜底） |
| `edgeLabelPersists` | 线条文字落库并显示在线上；清空后字段被移除 |
| `edgeInstantRunClick` | 点击线直接执行，且不弹编辑器 |
| `runSingleEdge` | 改写为「点击即执行」路径 |
| `toggleEdgeEnabled` | 改写为「即执行」开关（kind 切 manual，enabled 被清） |
| `promptHue` | 改写为「只剩一个取色器」，且不再写 `promptHue` |
| `editEdgePrompt` / `colorMarks` / `edgeEditorIsFloating` 等 | 改为经 `longPressEdge()` 打开编辑器 |

手工验证（浏览器脚本，沿路径取 t=0.2/0.35/0.5/0.65/0.8 五点）：
t=0.35~0.8 长按均弹出编辑器且不触发执行；单击 t=0.65 位置发出 1 个请求、不弹编辑器。

### 已知限制

- `promptHue` 字段保留但 UI 不再写；旧数据仍按「hue → promptHue → 主题色」回退渲染。
- 触屏长按会触发系统 `contextmenu`，已在命中区 `preventDefault` 吃掉；
  但部分浏览器仍会在长按末尾闪现选择柄，未做额外处理。
- 手柄元素 1×1 后，框架自带的 `.react-flow__handle` 默认样式全部靠我们的
  伪元素覆盖；若将来升级 React Flow 改动手柄量测算法，需回归一次端点位置。
