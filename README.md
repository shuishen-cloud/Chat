# shadcn-chat

基于 shadcn/ui 的 DeepSeek 对话客户端，支持「项目」维度组织对话。

## 功能

- **项目管理**：新建 / 重命名 / 删除项目，对话按项目归类
- **对话管理**：新建 / 重命名 / 删除 / 清空，支持跨项目移动
- **会话管理**：置顶、归档（可折叠/全部恢复）、创建副本、标题与全文搜索
- **消息收藏**：任意消息一键收藏，跨项目汇总面板，支持搜索、跳回原处、取消收藏
- **分支对话**：从任意消息处分叉，继承到该处的全部历史，可一键回原对话
- **画板**
  - 任意消息一键「加入画板」，或把整条对话铺成骨架链
  - 对话内「多选」勾选多条消息，一次性加入指定画板
  - 划词浮层可「加入指定画板」：选区按 DOM 结构还原为 Markdown，
    表格保持表格、代码块保留缩进与语言、列表保留层级
  - 与对话**并排**显示，切换会话不需要先关闭画板
  - 卡片可拖拽、缩放、连线（贝塞尔曲线）、展开全文、写批注，支持便签
  - **便签渲染 Markdown**：默认渲染态，点击即进入编辑；执行结果直接显示在便签里
  - 执行中的连线有流动动画，一眼看出哪条在跑
  - 画板宽度可拖拽调整（双击分隔条复位），也可一键最大化
  - **连线可执行**：材料 →（线提示词）→ 输出，四条边都可拖出连线，支持多材料汇聚
  - **任务**：先建任务，再点选要跑的线执行；每条线独立、可单独禁用，避免上下文污染
  - 每条线分「可执行」与「仅联系」两种，只有可执行的参与任务
  - **单线执行**：边编辑器「立即执行」或选中线按 Enter / Ctrl+Enter，无需建任务
  - **颜色标记**：节点、连线、侧边栏会话都可打 8 色标记，明暗主题各自适配
  - 节点内容可直接改写（标记「已改写」），可一键还原为原文
  - 每次执行都会在该节点留下历史，可回看输入/输出并回填
  - 卡片保留对源消息的引用：源消息更新即同步，删除对话时自动清理悬空引用
  - 「回到原消息」直接定位并高亮对应对话内容
  - 与对话同一个项目维度；多画板切换、重命名、删除
- **DeepSeek V4**
  - `deepseek-v4-pro`（默认）
  - `deepseek-v4-flash`
  - `deepseek-v4-flash-vision-exp`
  - SSE 流式输出，思维链（`reasoning_content`）可折叠展示
- **对话操作**：停止生成、重新生成、复制、导出 Markdown
- **思考开关**：可在设置里关闭思维链展示（不改变服务端行为，详见设置面板说明）
- **界面**：亮/暗主题、侧边栏折叠、智能贴底滚动、代码块一键复制
- **系统字体**：不加载任何字体文件、不引外部 CDN，正文与代码均使用系统字体栈
- **本地持久化**：状态存 `localStorage`，无需后端

## 技术栈

| 层 | 选型 |
|---|---|
| 构建 | Vite 8 |
| 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS v4 |
| 组件 | shadcn/ui（底层 Base UI） |
| 图标 | lucide-react |
| 提示 | sonner |
| Markdown | react-markdown + remark-gfm |
| 画布 | @xyflow/react（React Flow） |

## 开始

```bash
npm install
npm run dev
```

打开终端提示的地址，点击左下角**设置**，填入 DeepSeek API Key。

API Key 仅保存在浏览器 `localStorage`，不会上传到任何第三方，也不会写入仓库。

### 确认可用模型

若提示模型不存在，用以下命令列出账号下的模型标识：

```bash
curl https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```

也可以在设置对话框的「模型标识（可手动修改）」输入框中直接填写。

## 脚本

```bash
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
npm run lint     # oxlint
```

构建产物校验（字体、docker 配置）：

```bash
npm run build
node scripts/test-deploy.cjs
node scripts/test-remote-state.cjs   # 服务端存储与多端同步
```

## 部署

服务端是**一个 Node 进程**：既提供 `/api/state`（对话数据的权威副本），
也直接发送 `dist/` 静态产物。不再需要 nginx —— 对话历史必须由常驻进程
读写，纯静态托管做不到多端共享。

### 为什么不再是纯静态

旧版本把状态存在浏览器 `localStorage`，每台设备各一份。现在服务端保存
唯一副本，各端启动时拉取，因此「刷新后多端看到同一份历史」。

代价是必须有后端进程与一份持久化目录。

### Docker

```bash
# 构建镜像（多阶段：node 构建产物 → node 运行服务端）
docker build -t shadcn-chat:latest .

# 启动：必须挂数据卷，否则容器重建会丢掉全部对话
docker run -d --name shadcn-chat \
  -p 3000:3000 \
  -v shadcn-chat-data:/app/data \
  --restart unless-stopped \
  shadcn-chat:latest
```

运行阶段基于 `node:22-alpine`（Node 22 可直接执行 TypeScript，无需编译步骤）：

| 配置 | 作用 |
|---|---|
| `VOLUME /app/data` | 对话状态目录，必须挂卷持久化 |
| `STATE_FILE=/app/data/state.json` | 状态文件路径 |
| `PORT=3000` | 监听端口 |

服务端负责的事项：

| 能力 | 说明 |
|---|---|
| `GET /api/state` | 返回 `{updatedAt, state}`，服务端为空时 `state` 为 `null` |
| `PUT /api/state?base=` | 整包覆盖写入；`base` 不匹配返回 `409`，避免旧快照覆盖新数据 |
| SPA 回落 | 未知路径返回 `index.html`，`/api/*` 仍返回 404 |
| `/assets/` 强缓存 | 产物带内容哈希，可缓存一年 |
| `index.html` no-cache | 发版后能拿到新资源引用 |
| 原子写入 | 先写临时文件再 rename，进程被杀不会留下半截 JSON |

### 部署注意事项

真实部署前请逐条确认，这些都会导致「看起来能用但数据丢了」。

#### 1. 数据卷不能省

```bash
# 错误：容器一重建，全部对话消失
docker run -d -p 3000:3000 shadcn-chat:latest

# 正确：挂命名卷
docker run -d -p 3000:3000 -v shadcn-chat-data:/app/data shadcn-chat:latest
```

对话全部存在 `/app/data/state.json` 单个文件里。`docker rm` 不带 `-v`
时命名卷会保留；但**换主机、换卷名 = 数据不会跟过来**。

备份就是拷这个文件：

```bash
docker cp shadcn-chat:/app/data/state.json ./state-$(date +%F).json
```

恢复时把文件放回卷里即可。因为是整包覆盖写，备份文件可以直接当快照用。

#### 2. 必须单实例，不能多副本

`state.json` 是**整包读写**，没有文件锁。

- ✅ `docker run` 一个容器
- ❌ `--scale 3`、Kubernetes 多副本、多台机器共享同一个卷

多副本会互相覆盖，表现为「刚存的对话过一会儿变回旧的」。
免费额度够用的情况下，一个人用不到副本。

#### 3. 反向代理要放行 PUT 与请求体

`PUT /api/state` 的请求体是**整包状态**，会话多了会到几 MB。
nginx 默认 `client_max_body_size 1m`，会直接 `413`：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # 整包状态可能较大，按实际数据量放宽
    client_max_body_size 32m;

    # PUT 必须放行
    limit_except GET POST PUT { deny all; }
}
```

用 Cloudflare / 其他 CDN 时注意它们也有请求体上限（免费版 100MB 通常够）。

#### 4. 没有鉴权，务必自己加一层

服务端**不校验任何凭据**——任何能访问到 `3000` 端口的人都能读写你的全部
对话和 API Key。

至少做其中一件：

```bash
# A. 只绑本机，靠 SSH 隧道访问（最省事）
docker run -d -p 127.0.0.1:3000:3000 ...

# B. nginx Basic Auth
htpasswd -c /etc/nginx/.htpasswd yourname
```

```nginx
location / {
    auth_basic           "shadcn-chat";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3000;
}
```

**不要直接把 3000 端口暴露到公网。** 你的 DeepSeek API Key 就在
`state.json` 里，泄露等于 Key 泄露。

#### 5. HTTPS（不是必须，但强烈建议）

API Key 会随状态在网络上传输，且浏览器直连 `api.deepseek.com` 需要
HTTPS 页面才不会混内容拦截。用 Caddy 最省事：

```
chat.example.com {
    basicauth {
        yourname $2a$14$...
    }
    reverse_proxy 127.0.0.1:3000
}
```

#### 6. 多端并发写的预期行为

同一时刻两端都改：

- 后写的一方收到 `409`，**不会**覆盖先写的数据
- 收到 409 的端会拉取服务端最新内容覆盖本地，并弹「其他设备已更新」提示
- 代价是**那一端本次未落库的修改会丢失**（已确认这个取舍可接受）

典型场景：手机和电脑都开着，你在电脑发消息后 30 秒内又在手机改标题 →
手机那次修改可能被丢弃。刷新后重做即可。

#### 7. 流式生成期间不落库

正在流式输出时不会推送服务端（避免 token 级请求与半截回复）。
**生成结束后才写一次。** 所以另一端在生成过程中刷新，看不到这条回复，
生成完成后再刷新就有了。

#### 8. 首次启动会覆盖本地数据

服务端有数据时，前端启动会**整包替换**本地 `localStorage`，不做合并。
这是刻意设计（服务端为唯一真相）。

后果：**如果服务端被清空（换了空卷），各端再打开会用自己的本地数据
重新初始化服务端**——哪台先打开，就以哪台为准。

#### 9. 健康检查

```bash
curl -f http://127.0.0.1:3000/api/health   # {"ok":true}
```

Docker healthcheck 示例：

```bash
--health-cmd "wget -qO- http://127.0.0.1:3000/api/health || exit 1" \
--health-interval 30s --health-retries 3
```

#### 10. 升级

```bash
docker build -t shadcn-chat:latest .
docker rm -f shadcn-chat
docker run -d --name shadcn-chat -p 3000:3000 \
  -v shadcn-chat-data:/app/data --restart unless-stopped shadcn-chat:latest
```

`state.json` 结构跨版本兼容（服务端只当不透明 JSON 存取），
升级不需要迁移脚本。但**降级前先备份**。

### 已有 nginx

若坚持用 nginx 发静态产物，需要把 `/api/` 反代到上面的 Node 进程，
否则多端同步不可用：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

### 子路径部署

若部署在 `https://host/chat/` 这类子路径下，需在 `vite.config.ts` 设置
`base: '/chat/'` 后重新构建，否则 `/assets/...` 会指向根路径而 404。
默认配置为根路径部署（`base: '/'`）。注意 `/api/` 仍按绝对路径请求，
反向代理需相应调整。

### 关于 API 代理

应用仍是**浏览器直连** `api.deepseek.com`，API Key 随状态一起存在服务端
`state.json`（各端填一次即可，无需重复配置）。

如果目标环境无法直连外网，需要由服务端代理请求，届时 Key 只在服务端使用。

## 目录结构

```
src/
├── components/
│   ├── ui/                    # shadcn 生成的基础组件（勿手改）
│   ├── chat-sidebar.tsx       # 项目 + 会话列表
│   ├── chat-main.tsx          # 消息区 + 输入框 + 多选加入画板
│   ├── markdown.tsx           # Markdown 渲染 + 代码块复制
│   ├── quick-ask-layer.tsx    # 划词浮层的挂载与状态管理
│   ├── selection-quick-ask.tsx # 划词浮窗本体（追问/收藏/进画板）
│   ├── board-panel.tsx        # 画板主视图（工具条 + 空状态）
│   ├── board-canvas.tsx       # 画布封装 + 消息/便签自定义节点
│   ├── favorites-panel.tsx    # 跨项目收藏汇总面板
│   ├── prompt-history.tsx     # 右侧提示词历史
│   ├── hue-picker.tsx         # 8 色标记选择器
│   ├── settings-dialog.tsx    # API Key / 模型 / Base URL
│   └── error-boundary.tsx     # 面板级错误隔离
├── hooks/
│   ├── use-chat-store.ts      # 全部业务状态与动作
│   ├── use-scroll.ts          # 贴底滚动 / 输入框自增高 / 选区监听
│   └── use-is-dark.ts         # 当前是否暗色主题
├── lib/
│   ├── types.ts               # 领域类型与常量
│   ├── storage.ts             # localStorage 读写与画板引用清理
│   ├── deepseek.ts            # DeepSeek 流式客户端
│   ├── selection-to-markdown.ts # 划词选区 → Markdown 序列化
│   ├── hue.ts                 # 色相派生配色（明暗双主题）
│   └── utils.ts               # cn() 样式合并
└── App.tsx                    # 应用外壳（画板按需懒加载）
```

## 说明

- 无后端、无账号体系，数据完全在浏览器本地。
- 字体使用系统字体栈（苹方 / 微软雅黑 / Noto Sans CJK，逐级回退），
  不加载任何字体文件；系统缺字时由通用族兜底，不会出现豆腐块。
- 清空浏览器数据会丢失全部对话与画板，重要内容请用「导出为 Markdown」备份。
- 直连浏览器请求 DeepSeek API，若遇 CORS 问题需自行配置代理。
- 画板节点只保存对消息的引用，不复制正文；因此删除对话 / 清空消息后，相关卡片会自动移除。
