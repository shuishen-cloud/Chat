# 测试

需要 playwright（`npx playwright install chromium`，或复用已装好的 Chromium）。

```bash
# 先启动 dev server
npm run dev

# 跑全部用例（约 12s）
node scripts/test-quick-ask.cjs

# 只跑某个用例
CASE=freshSendCase node scripts/test-quick-ask.cjs

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
