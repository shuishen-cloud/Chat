# 画板连线执行：材料 → 提示词 → 输出

## 背景与心智模型

画板不是流程图，而是**思想库**：

- **节点 = 材料**。可以来自对话（引用原始消息），也可以是便签。材料是"不变"的部分。
- **边 = 一次处理动作**。边上挂提示词，代表"对起点材料做一次处理"。边是**独立可执行单元**，
  不是流水线的一节，边与边之间没有拓扑依赖。
- **任务 = 用户临时选出来的一批边**。先创建任务，再把边勾进任务，然后执行。

这样做的目的是**高效组织"变"与"不变"**：材料保持不变，只重跑需要变的那几条线；
不需要改的观点完全不动，也不会把无关上下文带进请求。

明确**不做**的事：

- 不做全量跑通（没有"一键运行整张图"）。
- 不做自动拓扑串联（A→B→C 不会因为选了 A→B 和 B→C 就自动串起来）。
- 不做唯一终点约束：多条边的终点可以不同，各自写回自己的终点。

## 数据模型

```ts
// 边
type BoardEdgeKind = "manual" | "reference" | "branch" | "flow"

interface BoardEdge {
  id: string
  boardId: string
  from: string
  to: string
  kind: BoardEdgeKind
  label?: string
  /** 该连线携带的提示词；kind=flow 时使用 */
  prompt?: string
  /** 是否参与执行，默认 true（undefined 视为 true） */
  enabled?: boolean
  /** 四向连接点标识，避免节点换边后连线错位 */
  sourceHandle?: string
  targetHandle?: string
}

// 节点扩展
interface BoardNode {
  // ...已有字段
  /** 用户直接改写的内容；存在时优先于源消息/excerpt 显示 */
  contentOverride?: string
  /** 运行历史（最新的在前） */
  runs?: NodeRun[]
}

// 一次运行记录
interface NodeRun {
  id: string
  /** 由哪条边触发 */
  edgeId: string
  /** 运行时的提示词快照（边后来改了也保留当时的值） */
  prompt: string
  /** 输入材料快照 */
  inputs: { nodeId: string; title: string; text: string }[]
  output: string
  error?: string
  createdAt: number
}

// 任务
interface BoardTask {
  id: string
  boardId: string
  name: string
  /** 加入任务的边 id 列表 */
  edgeIds: string[]
  createdAt: number
  updatedAt: number
}
```

`ChatState` 新增 `boardTasks: BoardTask[]`、`activeTaskId: string | null`。

## 语义区分（线的种类）

| kind | 用途 | 外观 | 可执行 |
|---|---|---|---|
| `manual` | 手动联系，纯视觉 | 灰细实线 | 否 |
| `reference` | 对话顺序骨架（自动生成） | 灰虚线、动画 | 否 |
| `branch` | 分支关系（预留） | 灰虚线 | 否 |
| `flow` | **数据流：材料 → 输出** | 主题色曲线 + 提示词徽章 + 箭头 | **是** |

判据只有一条：**只有 `flow` 边参与任务执行**。用户拖拽新建的边默认 `flow`；
想要纯联系时可在边菜单里改为"仅联系"（变成 `manual`）。

## 执行模型

任务执行时，对任务内**每条 `enabled !== false` 的 flow 边**独立发一次请求：

```
messages = [
  { role: "user", content: "【材料】<起点节点文本>\n\n【要求】<边上的 prompt>" }
]
```

- 结果写回**该边的终点节点**：`contentOverride = output`，并 `unshift` 一条 `NodeRun` 到 `runs`。
- 每条边互不影响：一条失败不阻断其余边。
- 禁用边直接跳过。
- 未配置 API Key：整体提示，不写任何历史。

## 用户操作流程

1. 拖线连接两个节点 → 默认是 flow 边，线上显示"未设置提示词"徽章。
2. 双击边（或点徽章）→ 编辑提示词；边菜单里可禁用/改为仅联系/删除。
3. 顶栏"任务"→ 新建任务 → 进入选边模式 → 点线加入任务。
4. 点"运行任务"→ 逐边执行，节点内容随之更新。
5. 节点上"历史"→ 查看该节点每次运行的输入/输出，可"回填到当前内容"。

## 节点可编辑

- 任意节点双击内容区 → 进入编辑 → 保存写入 `contentOverride`。
- 已被改写的引用节点显示"已改写"标记，并提供"还原为原文"（清空 `contentOverride`）。

## 校验方式

`scripts/test-board.cjs` 新增用例：

- `flowEdgeDefaults`：拖拽新建的边是 flow、默认启用
- `editEdgePrompt`：编辑提示词后持久化
- `toggleEdgeEnabled`：禁用后不参与执行
- `taskCreateAndSelectEdges`：创建任务、把边加入任务
- `runTaskWritesHistory`：执行后目标节点 `contentOverride` 更新、`runs` 追加一条
- `editNodeContent`：改写节点内容并持久化
- `restoreNodeContent`：还原为原文

## 实现与校验结果

（收尾阶段补充）
