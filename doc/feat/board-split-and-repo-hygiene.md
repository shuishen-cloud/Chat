# 画板组件拆分、首屏按需加载与仓库治理

## 背景

几轮功能叠加后，出现了三类工程性问题：

1. `board-canvas.tsx` 长到 1256 行，浮层编辑器、色点、运行历史全挤在一个文件里；
2. `public/fonts/` 里躺着两个上游字体源码包，`LxgwWenKai-main.zip` 有 396MB，
   而 Vite 对 `public/` 是原样拷贝，`dist` 直接涨到 409MB；
3. 画板依赖 `@xyflow/react`（数百 KB），却在 `App.tsx` 里静态导入，
   哪怕用户从不打开画板也要下载。

## 设计

### 一、拆分 `board-canvas.tsx`

按「是否自包含」判断，只搬确实独立的：

| 组件 | 迁往 | 理由 |
|---|---|---|
| `EdgeEditor` | `components/board/edge-editor.tsx` | 只依赖 `BoardEdge` + UI 基件 |
| `NodeHueButton` | `components/board/node-hue-button.tsx` | 只依赖 `HuePicker` |
| `HistoryList` + `formatRunTime` | `components/board/history-list.tsx` | 只依赖 `NodeRun` |

`NodeHandles` 保留：仅 25 行，且直接依赖画布内部的 `SIDES` / `POSITION` 常量，
拆出去反而要额外导出内部细节，耦合更差。

### 二、画板按需加载

`BoardPanel` 已经是条件渲染（`boardOpen` 为真才挂载），可以安全改成
`React.lazy` + `Suspense`。

### 三、仓库治理

- 删除两个字体 zip，`.gitignore` 加规则防复发；
- 保留 3 个实际被 `@font-face` 引用的 woff2（9.8MB）；
- 补 `public/fonts/README.md` 说明来源与 OFL-1.1 许可（分发要求附带许可声明）；
- README 目录结构补全 6 个缺失文件。

## 影响

- 对外行为不变，`BoardPanel` 首次打开时多一次 chunk 加载（有 loading 占位）。
- `dist` 从 409MB 降到 11MB；首屏 JS 从 983KB 降到 772KB。
- `.pdm/` 是开发流程记录，与 `doc/feat/*.md` 同属一套体系，应入库。

## 收尾记录

### 实现结果

| 组件 | 原行数 | 迁往 |
|---|---|---|
| `EdgeEditor` | 148 | `components/board/edge-editor.tsx` |
| `NodeHueButton` | 40 | `components/board/node-hue-button.tsx` |
| `HistoryList` + `formatRunTime` | 125 | `components/board/history-list.tsx` |

`board-canvas.tsx`：1256 → 927 行。

`NodeHandles` 保留在画布内：仅 25 行，且依赖 `SIDES` / `POSITION` 内部常量，
拆出去要额外导出内部细节，耦合反而更差。

### 体积变化

| 指标 | 前 | 后 |
|---|---|---|
| `dist` 总大小 | 409MB | 11MB |
| 首屏 JS | 983KB (gzip 307KB) | 772KB (gzip 240KB) |
| 画板 chunk | 无（打进首屏） | 213KB (gzip 68KB)，按需加载 |

### 校验

- `tsc -b`：0 错误
- `oxlint`：11 警告（无新增）
- Playwright：43/43 通过
- `npm run build`：chunk 正确拆分，dist 11MB

### 新增回归用例

`boardLazyLoads`：验证懒加载占位被真实画布替换、不残留 loading，
且拆出的 `EdgeEditor` 仍可正常打开。
