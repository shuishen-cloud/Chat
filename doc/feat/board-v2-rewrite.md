# 白板系统从零重写：单一数据源 + 交互状态机（board-v2-rewrite）

> 先于实现编写。本设计约束四件事：**状态只有一份**、**交互由显式状态机驱动**、
> **业务数据与框架数据一一映射且可逆**、**每个不变量都有纯函数可测**。
> 出问题时优先改文档再改代码——文档就是这个系统唯一的"宪法"。

## 问题

### 现状

`board-canvas.tsx`（1011 行）+ `use-chat-store.ts`（1973 行）实现了一套
**双层状态**：

```
entries(业务 store)  →  nodes(每次 map 重建)  →  localNodes(本地副本)  →  displayNodes
        ↑                    ↓                       ↓
    写 localStorage      白名单过滤 changes        靠 useEffect 覆盖回来
```

为了让它"看起来能用"，堆了 5 处补偿补丁：

| 补丁 | 解决的问题 | 引入的新脆弱性 |
|---|---|---|
| `dragging` 镜像 | 拖拽中途 store 不回写导致节点回弹 | 拖拽与 store 位置两套真值 |
| `localNodes` + `useEffect` | 让选中状态不被 `nodes` 重建冲掉 | 任何本地变更都可能在下次重建被抹掉 |
| `prevSelected` 集合 | 重建时保住 selected | 只能保住 selected，保不住尺寸 |
| `lastSelectedRef` 去重 | 避免选区回调死循环 | 外部清空选中时自己也不同步 |
| `onResize` 实时回写 | 缩放时尺寸被旧值覆盖 | 尺寸只写本地，松手才落库，等于又一套真值 |

### 根因

不是 React Flow 不够好，而是**我们用"业务 store 持有真值 + 手写双向同步"
的方式去驱动一个本身就有 store 的框架**。两套模型字段语义还不一致：

| 概念 | 业务 `BoardNode` | React Flow `Node` |
|---|---|---|
| 位置 | `x, y` | `position: {x, y}` |
| 尺寸 | `width?, height?`（空 = 自适应） | `width?, height?`（空 = 由 DOM 量测） |
| 选中 | 无 | `selected` |
| 拖拽中 | 无 | `dragging` |
| 内容 | `title/note/excerpt/contentOverride/runs/hue` | 统一塞进 `data` |

`width` 在两边"空值语义"不同，是缩放 bug 的**直接根因**：业务侧空 = 自适应，
框架侧空 = 尺寸未初始化，中途一方被另一方覆盖就出现"往左拉却向右长"。

### 证据（为什么问题一直没被发现）

- 6 次 feat 全在既有骨架上加字段，无一次审视骨架；
- `.pdm/notes` 13 条笔记里多条验证命令写成了 `pytest scripts/test-board.cjs`，
  实际从未跑通——"有测试兜底"是幻觉；
- `test-board.cjs` 用例全是**落库断言**，没有一条覆盖交互不变量
  （`dragFollowsPointerMidway` 是唯一例外，而缩放的镜像问题恰好没人补）。

## 规范

### 一、状态只有一份

**唯一真值 = React Flow 的 store**（`useNodesState` / `useEdgesState` 提供的
`onNodesChange` 直接 `applyNodeChanges`）。业务侧**不持有可变的画板状态**，
只持有：持久化快照 + 领域查询函数。

```
        用户交互
           ↓
   React Flow store (唯一真值)
     ↓              ↓
  渲染节点        onNodesChange / onEdgesChange
     ↓              ↓
  卡片组件       debounce → 快照导出 → localStorage
```

**禁止**：
- 禁止用 `useEffect` 把 store 数据覆盖回去（这是现状所有 bug 的温床）；
- 禁止在组件里维护"拖拽中坐标"之类的第二份真值；
- 禁止白名单过滤 `NodeChange`（位置/尺寸/选中一律放行，框架自己会算对）。

### 二、业务字段进 `data`，且映射可逆

领域模型只保留**真正需要持久化**的字段，坐标尺寸与选中归框架：

```ts
// 持久化领域模型（唯一的磁盘格式）
type BoardCard =
  | { kind: "message"; ref: { conversationId: string; messageId: string };
      title?: string; excerpt?: string; contentOverride?: string;
      expanded?: boolean; runs?: NodeRun[]; hue?: number }
  | { kind: "note"; note: string; title?: string;
      contentOverride?: string; runs?: NodeRun[]; hue?: number }

type BoardDoc = {
  nodes: BoardCardNode[]   // { id, card, position, width?, height?, zIndex? }
  edges: BoardEdgeDoc[]    // { id, from, to, kind, prompt?, enabled?, handles?, hue?, promptHue? }
}
```

**可逆性要求**（必须由测试保证）：

```
toFlow(doc) → fromFlow(...) ≡ doc      （字段级等价，忽略顺序）
```

`toFlow` / `fromFlow` 是纯函数，不读全局、不写 ref。

### 三、交互是显式状态机

所有指针交互归入一个状态机，避免"连线抢拖拽""缩放手柄抓到却变成拖节点"：

```ts
type Interaction =
  | { type: "idle" }
  | { type: "dragging"; nodeIds: string[] }
  | { type: "resizing"; nodeId: string; dir: ResizeDir }
  | { type: "connecting"; from: { nodeId: string; handle: HandleSide } }
  | { type: "marquee" }                       // 框选
  | { type: "edge-menu"; edgeId: string }     // 边编辑器打开
```

转移表（**唯一允许的触发路径**）：

| 当前 | 事件 | 下一状态 | 副作用 |
|---|---|---|---|
| idle | node:pointerdown | dragging | — |
| idle | resizer:pointerdown | resizing | — |
| idle | handle:pointerdown | connecting | 高亮可落点 |
| idle | canvas:pointerdown | marquee | — |
| idle | edge:click | edge-menu | 记录锚点 |
| dragging | pointerup | idle | 导出快照 |
| resizing | pointerup | idle | 导出快照 |
| connecting | pointerup(onTarget) | idle | 建边 |
| connecting | pointerup(空) | idle | — |
| marquee | pointerup | idle | 按矩形选节点 |
| 任意 | Escape | idle | 关菜单/取消 |

**只允许处于某状态时才挂对应事件**（例：`resizing` 状态下不响应 node 拖拽启动）。
这从结构上消灭"抢交互"类问题——不需要靠 CSS 层级和 `opacity` 去调。

### 四、缩放方向不变量

`resizeNode(box, dir, delta)` 是纯函数，必须满足：

- `dir` 含 `w`（west/左）：`right` 保持不变，`left` 与 `width` 同步增长；
- `dir` 含 `e`（右）：`left` 保持不变；
- `dir` 含 `n`（上）：`bottom` 保持不变；
- `dir` 含 `s`（下）：`top` 保持不变；
- 达到 `minWidth/minHeight` 后**夹紧，且不产生漂移**（连续拖动不再变）。

这正是本次 bug 的回归点，必须写成首个测试用例。

### 五、目录与职责

```
src/features/board-v2/
  model/          纯函数，无 React、无 DOM
    doc.ts          BoardDoc / BoardCard 类型 + 默认值
    map.ts          toFlow / fromFlow（可逆）
    resize.ts       resizeNode（方向不变量）
    changes.ts      applyDocChange（NodeChange → BoardDoc 增量）
  interaction/
    machine.ts      Interaction 类型 + reduceInteraction
  view/
    BoardCanvas2.tsx  ReactFlow 挂载、事件接线（只做接线）
    cards/MessageCard.tsx
    cards/NoteCard.tsx
    handles.tsx     四向手柄（单一命中区实现，不再叠三层）
  persist/
    snapshot.ts     快照导出（debounce）与读取
  index.ts          对外出口
```

**度量约束**：任一文件 ≤ 300 行；`view/` 不含业务判断，
`model/` 不含 React import。这两条用脚本检查。

### 六、直接替换，不做双轨

**v2 直接接管画板，旧实现删除，不保留双轨、不做数据迁移、不留 feature flag。**

- 旧 `board-canvas.tsx`、`board-panel.tsx` 中与 v2 重叠的部分**整体删除**，
  不留在仓库里“以备回退”——回退靠 git 历史，不靠并存代码。
  （理由：并存两套会让后来者不知道改哪一套，正是本次要消灭的债务形态。）
- 旧的 `boardNodes / boardEdges / boardTasks` 磁盘字段**不再读取**：
  启动时若检测到旧字段，直接丢弃并记录一条 warning（用户已知无需保留）。
- 画板侧栏按钮、任务栏、工具栏等**产品功能全部保留**，只是渲染实现换成 v2；
  不允许因为重写而丢功能。

### 七、画布（viewport）也归框架

现状把可视区域交给 `fitView`，但 `nodes` 每次重建会触发重新 fit。
v2 要求：**viewport（x/y/zoom）由框架持有，仅在首次挂载与显式
"适应视图"按钮时设置**，节点增删绝不改动 viewport。否则布局会自己漂。

## 接口

```ts
// model/doc.ts
export type BoardDoc = { nodes: BoardCardNode[]; edges: BoardEdgeDoc[] }
export function emptyDoc(): BoardDoc

// model/map.ts —— 可逆映射，纯函数
export function toFlow(doc: BoardDoc, ctx: CardContext): RtNode[]
export function fromFlow(nodes: RtNode[], edges: RtEdge[], prev: BoardDoc): BoardDoc

// model/resize.ts —— 方向不变量在这里
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
export type Box = { x: number; y: number; width: number; height: number }
export function resizeNode(box: Box, dir: ResizeDir, delta: { dx: number; dy: number },
                           min: { width: number; height: number }): Box

// model/changes.ts
export function applyDocChange(doc: BoardDoc, changes: NodeChange[]): BoardDoc

// interaction/machine.ts
export function reduceInteraction(state: Interaction, ev: InteractionEvent): Interaction
export function canStart(state: Interaction, want: Interaction["type"]): boolean

// persist/snapshot.ts
export function serialize(doc: BoardDoc): string
export function deserialize(raw: string): BoardDoc | null
```

调用方：`view/BoardCanvas2.tsx` 只负责把 DOM 事件翻译成 `InteractionEvent`、
把 store 变更翻成 `BoardDoc` 快照。**组件里不出现业务判断**。

## 日志

- 拖拽/缩放结束：记录一次 `{nodeId, x, y, width, height}` 的落库（debug 级）。
- 启动时发现旧画板字段：记录一条 warning（字段名 + 条数），说明已丢弃。
- 状态机非法转移（如 `resizing` 收到 `dragging` 启动）：记录一条 warning，
  这通常意味着某个组件绕过状态机直接挂了事件——是设计要抓的 bug。
- 快照写库失败：记录错误，保留内存态，UI 提示可重试。

## 兜底

- **旧字段残留**：不读取、不写入；记录 warning 后忽略，不做迁移。
- **快照写库失败**（配额/隐私模式）：捕获后提示"改动未保存"，内存态继续可用；
  下次成功写库时补上。
- **未知卡片 kind**：渲染为占位卡片，保留数据不删除，避免前向不兼容丢字段。
- **`fromFlow` 遇到框架追加字段**：忽略未知字段，不报错。
- **非法状态转移**：`reduceInteraction` 保持原状态（不抛异常），并记 warning。
- **尺寸/坐标 NaN 或负数**：`resizeNode` 夹紧到 `min` 与有限值。

## 实现与校验结果（收尾）

**在 close 阶段补写。**
