# shadcn-chat

基于 shadcn/ui 的 DeepSeek 对话客户端，支持「项目」维度组织对话。

## 功能

- **项目管理**：新建 / 重命名 / 删除项目，对话按项目归类
- **对话管理**：新建 / 重命名 / 删除 / 清空，支持跨项目移动
- **DeepSeek V4**
  - `deepseek-v4-pro`（默认）
  - `deepseek-v4-flash`
  - `deepseek-v4-flash-vision-exp`
  - SSE 流式输出，思维链（`reasoning_content`）可折叠展示
- **对话操作**：停止生成、重新生成、复制、导出 Markdown
- **界面**：亮/暗主题、侧边栏折叠、智能贴底滚动、代码块一键复制
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

## 目录结构

```
src/
├── components/
│   ├── ui/                 # shadcn 生成的基础组件（勿手改）
│   ├── chat-sidebar.tsx    # 项目 + 会话列表
│   ├── chat-main.tsx       # 消息区 + 输入框
│   ├── settings-dialog.tsx # API Key / 模型 / Base URL
│   └── markdown.tsx        # Markdown 渲染 + 代码块
├── hooks/
│   ├── use-chat-store.ts   # 全部业务状态与动作
│   └── use-scroll.ts       # 贴底滚动 / 输入框自增高
├── lib/
│   ├── types.ts            # 领域类型与常量
│   ├── storage.ts          # localStorage 读写
│   └── deepseek.ts         # DeepSeek 流式客户端
└── App.tsx                 # 应用外壳
```

## 说明

- 无后端、无账号体系，数据完全在浏览器本地。
- 清空浏览器数据会丢失全部对话，重要内容请用「导出为 Markdown」备份。
- 直连浏览器请求 DeepSeek API，若遇 CORS 问题需自行配置代理。
