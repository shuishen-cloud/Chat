# 会话历史服务端存储与多端刷新可见

## 背景

当前所有对话存在浏览器 `localStorage`（key `shadcn-chat/state/v1`，整包
`ChatState` JSON）。这意味着：

- 换设备 / 换浏览器 = 从零开始，历史无法带走
- 多端（手机、公司电脑、家里电脑）各自一份数据，永远对不上
- 清浏览器缓存 = 全部对话丢失

用户诉求是「一个人、多端、能看到同一份对话历史」。**不需要**多用户、不需要
协同编辑、不需要实时推送——**刷新后能看到一致的内容即可**。

用户明确表示：**本地现有对话可以全部舍弃**，服务端是唯一真相。

## 目标

1. 服务端持久化整包 `ChatState`，重启不丢
2. 前端启动时从服务端拉取并覆盖本地，实现「刷新即可见」
3. 前端状态变化时向服务端推送（防抖），保证任何一端的修改都会落库
4. 检测并避免「旧状态覆盖新状态」导致的丢消息
5. 部署形态：单 Node 容器（同时 serve 静态产物与 API）+ 数据卷

## 非目标（明确不做）

- ❌ 多用户 / 登录 / 权限（靠部署层：内网或反代 Basic Auth）
- ❌ 实时推送（SSE / WebSocket / 轮询）
- ❌ 增量同步、按会话拉取、按消息落库
- ❌ 数据库（SQLite / Postgres / PGlite）——单文件 JSON 足够
- ❌ localStorage 与服务端数据的合并（本地只作为缓存与离线兜底）
- ❌ 会话导出（下一期；届时从 `state.json` 直接序列化）
- ❌ 拆表、外键级联（`gcBoardRefs` 保持现状，跑在内存里）

## 数据模型

### 服务端存储文件

`data/state.json`（路径由环境变量 `STATE_FILE` 覆盖，默认 `<repo>/data/state.json`）：

```json
{
  "updatedAt": 1763000000000,
  "state": { "...ChatState 原样..." }
}
```

- `updatedAt`：服务端写入时的时间戳（毫秒）。**唯一用途是并发写检测**，
  不是版本号，客户端不能自己编造。
- `state`：`src/lib/types.ts` 的 `ChatState`，不做任何裁剪。
  - 包含 `apiKey`。自用场景下这是**特性**：一端填好，各端同步得到。
  - 服务端只当作不透明 JSON 存取，不解析字段含义。

### 写入原子性

写临时文件 → `fs.rename` 覆盖。同一文件系统内 rename 原子，避免进程在
写入中途被杀导致文件半截、下次读取 JSON 解析失败。

## 接口契约

### `GET /api/state`

返回：

```json
{ "updatedAt": 1763000000000, "state": { ... } }
```

- 文件不存在或解析失败 → `200` + `{ "updatedAt": 0, "state": null }`
  （不返 404，前端不需要分支处理错误态；`state === null` 即「服务端为空」）

### `PUT /api/state?base=<updatedAt>`

请求体：`ChatState` 本体（不带外层包装）。

- `base` 匹配服务端当前 `updatedAt` → 写入，返回
  `{ "updatedAt": <新值> }`
- `base` 不匹配（服务端已被其他设备更新）→ `409` + `{ "updatedAt": <服务端当前值> }`
- 请求体不是合法 JSON 或不是对象 → `400`

语义：**客户端必须证明自己基于最新副本**，否则拒绝写入，避免服务端的新消息
被客户端的旧快照覆盖。`base=0` 表示「服务端为空时初始化」。

### `GET /api/health`

返回 `{ "ok": true }`。仅用于容器健康检查与调试。

### 静态产物

同进程 serve `dist/`：

- `/assets/*` → 强缓存（文件名含内容哈希）
- `/`、其他路径 → 回落 `index.html`（SPA）
- `/index.html` → `no-cache`

## 前端改动

### `src/lib/storage.ts`

- 新增 `fetchRemoteState()`：`GET /api/state`，返回 `{ updatedAt, state }` 或
  `null`（网络失败）
- 新增 `pushRemoteState(state, base)`：`PUT`，返回
  `{ ok: true, updatedAt }` / `{ ok: false, conflict: true, updatedAt }` / `null`（网络失败）
- `loadState()` / `saveState()` **签名不变**，保持 localStorage 同步读写
  （首屏同步渲染不白屏；`use-chat-store.ts` 的 200ms 防抖保存不动）

### `src/hooks/use-chat-store.ts`

- 新增启动 effect：`fetchRemoteState()`
  - 成功且 `state !== null` → `setState(remote.state)`，同时记下
    `remoteUpdatedAtRef`
  - 成功且 `state === null` → 用本地当前状态 `PUT ?base=0` 初始化服务端
  - 网络失败 → 静默，继续用 localStorage
- 保存 effect 末尾追加服务端推送：
  - 存在 `streaming: true` 的消息时**跳过**，避免半截回复与 token 级请求风暴
  - 防抖 800ms，携带 `base = remoteUpdatedAtRef.current`
  - 成功 → 更新 `remoteUpdatedAtRef`
  - `409` → 拉取服务端最新并覆盖本地，toast 提示「其他设备已更新，已同步」
  - 网络失败 → 静默（本地已存，下次状态变化会重试）

## 失败与降级

| 场景 | 行为 |
|---|---|
| `GET` 网络失败 | 静默，用 localStorage，功能不受影响 |
| `PUT` 网络失败 | 静默，本地已保存；下次状态变化重试 |
| `PUT` 409 | 拉服务端覆盖本地 + toast 提示 |
| 服务端文件损坏 | `GET` 返回 `state: null`，前端按「服务端为空」重新初始化（会覆盖损坏文件） |
| 磁盘写满 | `PUT` 返回 `500`，前端静默；用户仍可继续使用（数据在 localStorage） |
| 多端同时写 | 后到者收到 409，被要求重新同步，**不覆盖** |
| 流式生成中 | 不推送；生成结束后统一推一次 |

## 部署

`Dockerfile` 改为 Node 单容器：

- 构建阶段：`npm ci && npm run build`（不变）
- 运行阶段：`node:22-alpine`，拷 `dist/` 与 `server/`，`npm i hono @hono/node-server`
- `VOLUME /app/data`，`ENV STATE_FILE=/app/data/state.json`
- `EXPOSE 3000`

数据卷必须挂载，否则容器重建即丢全部对话。

## 验收标准

1. 启动后端，`GET /api/state` 返回 `{updatedAt:0, state:null}`
2. 打开页面 A，自动初始化服务端；`GET /api/state` 的 `state` 非空
3. 在 A 中新建会话并发送消息，等待落库
4. 打开页面 B（独立 context，无共享 localStorage），**看到与 A 相同的会话列表**
5. 在 B 中新建一条会话，A 刷新后能看到
6. 用旧 `base` 发 `PUT` → `409`，服务端数据不变
7. 流式生成期间观察网络：不产生 `PUT`；生成结束后产生一次
8. 后端不可达时页面仍可用（降级到 localStorage）
