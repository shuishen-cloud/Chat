# 画板新卡片落点：按分支关系自动排布（board-branch-layout）

> 用户反馈：「画板对于分支对话的展示十分不美观（都堆叠在一起）」。
> 本设计只解决**新卡片落在哪**，不新增排布按钮、不做一键整理、不改已有卡片坐标。

## 问题

### 现象

把分支对话里的消息陆续加入画板后，卡片会**互相叠在一起**，分支关系在画布上
完全看不出来，横向还会溢出可视区需要平移。

### 根因

`src/lib/types.ts::createBoardNode` 用**卡片总数**算网格：

```ts
const col = index % BOARD_COLUMNS   // BOARD_COLUMNS = 3
const row = Math.floor(index / BOARD_COLUMNS)
x = col * (BOARD_NODE_W + BOARD_GAP_X)
y = row * (BOARD_NODE_H + BOARD_GAP_Y)
```

`index` 由调用方传「当前画板已有的卡片数」（`siblings.length`）。这有三处必然出错：

1. **删卡后 index 回流**：已有 5 张、删掉 2 张，下一张的 index 又是 3，
   落点与现存第 3 张完全重合——这是「堆叠」最直接、最常见的来源。
2. **与画布真实几何无关**：`siblings.length` 不反映任何一张卡的实际位置。
   用户拖过一次之后，网格坐标就和实际排布脱节，新卡可能落在任意已有卡片上。
3. **无视分支关系**：从某条消息分支出新对话，再把分支里的回答加入画板时，
   新卡落点与它的「父卡片」（源对话里那条被分叉的消息）没有任何几何关联。
   一张分支树被摊成互不相干的行列，用户看不出「谁是谁的分支」。

此外 `BOARD_COLUMNS = 3`、`BOARD_NODE_W = 260`、`BOARD_GAP_X = 60`，
三列宽 900px，而画板在侧栏打开时可视宽度常不足 700px，第 3 列天然看不见。

### 反例（可复现）

画板已有 `n1(0,0) n2(320,0) n3(640,0) n4(0,220) n5(320,220) n6(640,220)`，
删除 `n2`/`n4` 后加入一张便签：`index = 4 → col=1,row=1 → (320,220)`，
与现存 `n5` 完全重合。

## 规范

### 一、落点是一个纯函数

```ts
// src/features/board-v2/model/layout.ts —— 无 React、无 DOM、不读全局
export type Rect = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }

export type PlaceInput = {
  /** 画布上已有的卡片（只用几何） */
  cards: Rect[]
  /** 已有连线，用于判断层级（from → to） */
  edges: Array<{ from: string; to: string }>
  /** 新卡片尺寸 */
  size: { width: number; height: number }
  /** 期望的归属：父卡片 id（分支）或上游卡片 id（承接） */
  anchor?: string | null
  /** 与 anchor 的关系，决定往哪个方向让位 */
  relation?: "branch" | "chain"
  /** 额外占位（同批次已排好的新卡片） */
  occupied?: Array<Rect & { id: string }>
  gap?: number
}

export function placeCard(input: PlaceInput): Point
export function placeBatch(input: PlaceBatchInput): Point[]
```

**不变量**（测试逐条断言，全部由纯函数保证）：

1. **不重叠**：返回值与 `cards`／`occupied` 中任一卡片都不相交，除画布为空外。
2. **分支向右**：`relation = "branch"` 且有 `anchor` 时，落点必须在 anchor 右侧，
   垂直方向与 anchor 对齐或在其下方。
3. **承接向下**：`relation = "chain"` 且 anchor 已有一条向下的出边时，
   落点在同一列继续向下，不与前驱重叠。
4. **兄弟下排**：同一 anchor 的第二个分支落在第一个分支正下方。
5. **无 anchor 也不重叠**：按有向图分层（label = 最长前驱链长度），
   优先落在最底层的右下方空位；找不到则网格扫描兜底。
6. **恒有限**：任何输入（空画布、NaN、负坐标、几千张卡片）都返回有限坐标。
7. **删卡不回流**：删除中间卡片后，下一次落点只由**现存卡片**决定，
   不会因为「数量变少」而回到旧格子。

### 二、分支父卡片怎么找

画板卡片只存 `ref: { conversationId, messageId }`。分支关系在 `Conversation.branchedFrom`：

```ts
branchedFrom?: { conversationId: string; conversationTitle: string; messageId: string }
```

但 `branchFrom` 在复制历史时**重新分配了 message id**（`id: uid("msg")`），
所以 `branchedFrom.messageId` 指向的是**源对话**里的那条消息，而分支对话里对应的
消息 id 是新的。识别父卡片的规则：

1. 分支对话里该消息的下标 `cutIndex`；
2. 源对话里下标同为 `cutIndex` 的消息 id；
3. 在画板卡片中查找 `conversationId = 源对话 && messageId = 该 id` 的卡片。

找不到（源对话那条消息没上画板／下标对不上）就返回 `null`，按无 anchor 处理。
这是**尽力而为的启发式**，不做强保证——画板上本来就可能只有分支、没有源。

父卡片查找放在 `layout.ts` 里作为纯函数 `findBranchParent()`，
输入是 `conversations`（只读）与卡片列表，便于单测。

### 三、store 侧怎么用

`createBoardNode` 不再自己算坐标，改为**接受坐标参数**（默认 0,0 只为兼容签名）。
四处新增入口统一改成先调 `placeCard` / `placeBatch`：

| 入口 | anchor | relation |
|---|---|---|
| `addMessageToBoard` / `addMessageToBoardSmart` | `findBranchParent()` | `branch`；找不到则 `chain`（同对话上一条已上画板的消息） |
| `addMessagesToBoard`（批量） | 同上，逐张 | 同上 |
| `addExcerptToBoard` | `findBranchParent()` | 同上 |
| `addNote` | 无 | 无 anchor |
| `addConversationToBoard` | 无（纵向链） | 整条链作为一次 `placeBatch`，base 位置避开已有卡片 |

`addConversationToBoard` 保留现有「纵向成链」的产品语义，但链的**起点**
改为 `placeCard` 的结果，而不是固定 `x=0`。

### 四、不做什么

- **不做自动重排（re-layout）**：用户拖过的坐标是高价值信息，绝不能被自动覆盖。
  只决定新卡落点。
- **不新增「一键整理」按钮**：本次不扩大产品面，等落点稳定后再评估。
- **不改 `BoardNode` 结构**：不新增字段，不迁移数据。

## 接口

```ts
// src/features/board-v2/model/layout.ts
export const LAYOUT_GAP = 32
export const BRANCH_OFFSET_X = 320
export function placeCard(input: PlaceInput): Point
export function placeBatch(input: PlaceBatchInput): Point[]
export function findBranchParent(
  convId: string,
  messageId: string,
  conversations: ReadonlyArray<Conversation>,
  cards: ReadonlyArray<{ id: string; ref?: { conversationId: string; messageId: string } }>
): string | null

// src/lib/types.ts
export function createBoardNode(
  boardId: string,
  ref: { conversationId: string; messageId: string },
  at: { x: number; y: number },
  excerpt?: string
): BoardNode
```

## 日志

- 新卡片落点：debug 级 `{ cardId, anchor, strategy }`，
  `strategy ∈ "branch" | "chain" | "layer" | "grid"`。
  `grid` 表示走到了兜底扫描，频繁出现说明画布拥挤，值得关注。

## 兜底

- **画布极拥挤**：候选点扫描上限（约 400 个）用尽后，取「所有卡片 x 最大值 + 间距」
  作为新列起点，纵向从头扫描，仍保证不重叠。
- **尺寸非法**（NaN/≤0）：夹紧到 `MIN_SIZE`，坐标恒有限。
- **anchor 指向已不存在的卡片**：忽略 anchor，按无 anchor 处理。
- **父卡片识别失败**：`findBranchParent` 返回 `null`，退回 `chain` 或分层布局。
- **`branchedFrom` 缺失**（老数据）：按普通消息处理。

## 影响

- 只改变新卡落点；**已有卡片坐标一律不动**。
- `createBoardNode` 签名变化：`index: number` → `at: {x,y}`，
  四个内部调用方同步修改，无外部调用。
- `BOARD_COLUMNS` 常量不再使用，从 `types.ts` 移除（保留 `BOARD_NODE_W/H`、
  `BOARD_GAP_X/Y` 供 layout 的默认尺寸参考）。

## 实现与校验结果（收尾）

**在 close 阶段补写。**
