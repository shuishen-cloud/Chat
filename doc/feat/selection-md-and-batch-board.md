# 划词结构还原、批量进画板、提示词徽章配色

## 背景

三件事凑在一起做，因为它们同时动到「消息 → 画板」这条链路：

1. 划词后进画板的是一坨纯文本，表格、代码块、列表全部退化；
2. 只能一条一条加进画板，想整理几段结论得点很多次；
3. 边上的提示词徽章只能跟着线走同一个颜色，想强调提示词就得把整条线染色。

## 设计

### 一、选区序列化（`lib/selection-to-markdown.ts`）

不能用 `selection.toString()`：浏览器在表格里用 `\t` 连接单元格、丢表头分隔行，
在代码块里丢缩进，列表和引用也退化成纯文本。

改为按 DOM 节点类型重新序列化：

- 结构性元素（`TABLE` / `PRE` / `UL` / `OL`）优先整块输出；
- 用户可能只选表格的两行、或从表格中间选到代码块中间，所以要把 Range 拆成
  「若干完整节点 + 最多两个部分节点」，分别处理；
- UI 文案（代码块的「复制」按钮）必须排除。

**关键坑**：代码块的「复制」按钮和 `<pre>` 是**兄弟节点**，同在一个 wrapper `div`
里。整条消息全选时，顶层块就是这个 wrapper，会走 `serializeBlock → serializeChildren`，
而那条路径不经过 `walk` 的 `isUiChrome` 检查，按钮文字就被当成正文输出了。
因此 UI 过滤必须下沉到序列化的最内层（`serializeInline`）统一做。

同时 wrapper `div` 里如果嵌了 `pre`，不能当普通行内内容处理，否则围栏代码块会退化成
「用反引号包起来的代码」。所以 `serializeBlock` 遇到含结构元素的容器要逐个序列化子节点。

### 二、批量进画板

对话里开「多选」模式，勾选多条消息一次性加入指定画板。多选期间关掉划词浮层，
否则点击消息会被浮层抢走交互。

### 三、提示词徽章独立配色

`BoardEdge` 增加 `promptHue`，与 `hue`（线的颜色）分开：线可以中性，只让提示词显眼；
反之亦然。

## 影响

- `useSelectionWatcher` 的返回值新增 `markdown` 字段，`SelectionContext` 同步扩展。
  调用方需传 `ctx.markdown || ctx.text`，旧字段 `text` 保留用于长度判断。
- `BoardEdge.promptHue` 为可选字段，旧数据无需迁移。

## 收尾记录

### 实现结果

- `lib/selection-to-markdown.ts`：按 DOM 节点类型重新序列化，结构性元素整块输出，
  部分选区拆成「完整节点 + 首尾截断」。
- `chat-main.tsx`：多选模式勾选多条消息批量加入指定画板。
- `BoardEdge.promptHue`：提示词徽章与线颜色解耦。

### 过程中发现并修复的缺陷

| 缺陷 | 根因 | 修法 |
|---|---|---|
| 全选时「复制」按钮文字进正文 | UI 过滤只在 `walk` 里做，而全选走 `serializeBlock` 路径绕过了它 | 过滤下沉到 `serializeInline` 最内层 |
| 重新生成时提问发两遍 | `regenerate` 先 `setState` 截断再 `await send`，`send` 读到截断前的闭包 | `send` 加 `override` 参数显式传入历史 |
| 点第一条回复却重跑最后一条 | `regenerate(activeConversation)` 完全忽略消息 id | 传 `m.id`，从该处截断重发 |
| 导出文件名含非法字符 | `a.download` 直用标题 | 新增 `sanitizeFilename`，并延后 `revokeObjectURL` |
| localStorage 写满静默丢数据 | `catch {}` 空实现 | `saveState` 返回 `false`，store 提示 |
| 测试开箱连接被拒 | Vite 默认端口/仅 IPv6，脚本连 127.0.0.1:5199 | `vite.config.ts` 固定端口与 host |

### 校验

- `tsc -b`：0 错误
- `oxlint`：11 警告（均为既有代码，warn 级）
- Playwright：12/12 通过

### 回归用例

- `selectionSerializesStructure`：含全选不含按钮文案、代码块保持围栏形式
- `selectionAddToBoard` / `checkboxBatchAdd` / `promptHue`
- `regenerateContextCase`：断言请求体里提问不重复、旧回答已移除
