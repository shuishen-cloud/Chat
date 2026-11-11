# 测试

需要 playwright（`npx playwright install chromium`，或复用已装好的 Chromium）。

```bash
# 先启动 dev server
npm run dev

# 跑全部用例（约 12s）
node scripts/test-quick-ask.cjs

# 画板用例（约 11s）
node scripts/test-board.cjs

# 只跑某个用例
CASE=freshSendCase node scripts/test-quick-ask.cjs
CASE=addFromMessage node scripts/test-board.cjs

# 列出所有用例名
CASE=--list node scripts/test-quick-ask.cjs
```

## 速度设计

| 手段 | 效果 |
|---|---|
| 整个进程只启动一次浏览器 | 省掉 11 次 Chromium 启动，约 10s |
| 每个用例新建轻量 context | 存储天然隔离，比清 localStorage 更可靠 |
| 轮询等待替代 34 处固定 sleep | 省掉约 12s |
| 默认超时 3s | 选择器写错快速失败 |
| `CASE=xxx` 单跑 | 调试时只跑一个用例 |

从 34s 优化到 14s（约 2.4 倍），且消除了用例间的偶发失败。

## 画板用例覆盖

| 用例 | 验证点 |
|---|---|
| `addFromMessage` | 消息动作条加入画板，节点引用源消息并渲染 |
| `dedupe` | 重复加入不产生重复节点 |
| `wholeConversation` | 整条对话铺入，自动生成 reference 边 |
| `editNote` | 便签编辑写回 store |
| `dragPersistsPosition` | 拖拽在 dragStop 时提交坐标 |
| `gcOnConversationDelete` | 删除对话后悬空引用被 gc |
| `autoCreateBoard` | 无画板时自动建板 |
| `switchBoard` | 切换画板（空板显示空态、切回恢复卡片） |
| `dragFollowsPointerMidway` | 拖拽**中途**卡片已跟随，而非松手才跳 |
| `resizePersists` | 选中出缩放手柄、尺寸落库 |
| `jumpBackToMessage` | 回原消息：切回对话视图 + 高亮定位 |
| `edgesAreCurves` | 连线为贝塞尔曲线（路径含 C 命令） |
| `switchConversationWithBoardOpen` | 画板打开时仍可切换会话 |
| `checkboxBatchAdd` | 多选消息批量加入指定画板 |
| `flowEdgeDefaults` | 拖拽新建的线默认是 flow 且启用 |
| `editEdgePrompt` | 编辑边上的提示词并持久化 |
| `toggleEdgeEnabled` | 禁用某条线 |
| `taskCreateAndSelectEdges` | 创建任务并点线加入 |
| `runTaskWritesHistory` | 执行任务写回节点内容与历史 |
| `editNodeContent` | 直接改写节点内容 |
| `restoreNodeContent` | 还原为原文 |
| `multiEdgeConvergeKeepsAll` | 多线汇聚同一节点时结果拼接保留 |
| `colorMarks` | 节点/连线颜色标记持久化 |
| `colorConversation` | 侧边栏会话颜色标记 |
| `hueDarkContrast` | 暗色配色不与浅色复用（防过曝） |
| `runSingleEdge` | 不建任务直接执行一条线 |
| `runEdgeKeyboard` | 选中线按 Enter / Ctrl+Enter 执行 |
| `thinkingToggle` | 关闭思考后请求体不含非标字段 |
| `historyRendering` | 历史区含时间/提示词/输入摘要 |
| `selectionSerializesStructure` | 选区还原 Markdown：表格/代码块/列表结构正确 |
| `selectionAddToBoard` | 划词加入**指定**画板，片段保留结构 |

> 曾尝试用例间只 reload 复用同一 context（11s），但出现偶发状态泄漏，
> 故改为每用例独立 context，用 4s 换取确定性。

## 等待的正确姿势

**不要**用固定 `waitForTimeout`，按场景选：

```js
await t.untilCount(selector, n)        // 等元素数量
await t.untilVisible(selector)         // 等元素可见
await t.untilState(s => ...)           // 等持久化状态（store 有 200ms 防抖）
await t.until(async () => ...)         // 自定义条件
await t.settle()                       // 等一帧渲染（仅用于纯视觉变更）
```

`t.state()` 直接读 localStorage 可能拿到旧值（防抖 200ms 未落盘），
需要断言状态时用 `t.stateUntil(predicate)`。

## 其他约定

- `selectIn()` 用 DOM Range 精确选文本，跳过头像等短文本节点
- 断言失败立即抛出，避免后续步骤连带报错
- 每个用例开始时自动清空错误收集，失败时会附上控制台错误
- 用例之间互相独立：各自 `seed()` 完整状态，不依赖执行顺序
