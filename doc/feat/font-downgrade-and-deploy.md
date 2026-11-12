# 字体降级为系统字体栈，并补齐 Nginx/Docker 部署产物

## 背景

本项目要部署到带 Nginx 与 Docker 的服务器上。动手部署前，有两类问题必须先解决。

### 一、字体：自托管带来的 9.8MB 负担

`public/fonts/` 里放了三份自托管字体：

| 文件 | 体积 | 字形数 |
|---|---|---|
| `lxgw-wenkai/LXGWWenKai-Regular.woff2` | 4841 KB | 21503 |
| `lxgw-wenkai/LXGWWenKai-Medium.woff2` | 5219 KB | 21503 |
| `fira-code/FiraCode-VF.woff2` | 110 KB | 2030 |

问题不在仓库体积，而在**首屏**：`index.html` 用 `<link rel="preload">` 预加载了
Regular 那份，等于每次首屏都要拖 4.8MB 才能把正文显示出来。

评估过两种优化：

1. **Unicode 区块切片**（Google Fonts 的做法）：按区块生成多份分片 + `unicode-range`。
   实测需要 8 个切片 × 3 个字体 = 24 个文件，存在多分片串行加载的可能，
   首屏仍有 2~3 个请求。
2. **按实际用字子集化**：扫描源码取出实际用到的 864 个汉字，实测
   Regular 从 4841 KB 降到 210 KB（−95.7%），Medium 208 KB，Fira Code 33 KB。

第二种体积收益很大，但它引入一个持续的维护负担：**代码里新增中文文案时若忘记
重新生成子集，新字就会掉出字体**。虽然可以用 `prebuild` 钩子自动化，但子集产物
会随源码漂移，git 里躺着的是「生成物」，review 时看不出对错。

### 二、决策：降级为系统字体栈

字体不是本产品的核心卖点，而是观感修饰。因此选择**最简的一条路**：

> 删掉全部自托管字体。正文与代码直接使用操作系统的既有字体；
> 系统里有什么就用什么，缺失时逐级回退到通用族。

具体含义（与需求原话对齐）：

- **不做字形兜底**：不保留一份子集主字体再让生僻字回退系统字体；
  整份字体全部交给系统。
- **不引入外部 CDN**：不请求 Google Fonts / 任何第三方，避免部署环境无外网时
  字体加载挂起。
- **缺失即回退**：CSS 字体栈逐级降级，最终落到通用 `sans-serif` / `monospace`，
  保证任何环境都不会出现豆腐块。

代价：观感从霞鹜文楷变成系统黑体。macOS 下是苹方，Windows 下是微软雅黑，
Linux 下取决于系统装了什么。这是明确接受的取舍。

## 设计

### 一、CSS 字体栈

`src/index.css` 删除三处 `@font-face`，两个变量改为纯系统栈：

```css
/* 正文：优先中文系统字体，逐级回退到通用族 */
--font-sans: system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB',
             'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;

/* 等宽：仅用于代码场景 */
--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
             'Liberation Mono', monospace;
```

栈的设计要点：

| 位置 | 字体 | 理由 |
|---|---|---|
| 1 | `system-ui` | 让浏览器直接用平台 UI 字体，新增平台无需改代码 |
| 2 | `-apple-system` | 旧版 Safari/WebKit 不认 `system-ui`，留作兼容 |
| 3 | `PingFang SC` | macOS 中文主力 |
| 4 | `Hiragino Sans GB` | 老 macOS 兜底 |
| 5 | `Microsoft YaHei` | Windows 中文主力 |
| 6 | `Noto Sans CJK SC` | Linux（含本项目的 Docker 基础镜像）常见中文 |
| 7 | `sans-serif` | 通用族，保证一定命中 |

`--font-mono` 同理，保持 `ui-monospace` 优先，其余为各平台常见等宽字体。

### 二、清理

- 删除 `public/fonts/` 整个目录（含 `README.md` 与三份 woff2，共 9.8MB）；
- `index.html` 删掉两个 `<link rel="preload" ... as="font">`；
- `.gitignore` 里针对 `public/fonts/*.zip`、`*.ttf`、`*.otf` 的规则一并删除
  （目录已不存在，留着只会误导）；
- `README.md` 删掉「自托管字体」一条，在说明里点明改用系统字体。

### 三、部署产物

#### Dockerfile

多阶段构建，避免把 `node_modules` 和源码带进运行镜像：

```
阶段 1（builder）：node:22-alpine → npm ci → npm run build → /app/dist
阶段 2（runtime）：nginx:1.27-alpine → COPY --from=builder /app/dist → html 根
```

要点：

- `npm ci` 而非 `npm install`：锁文件一致，构建可复现；
- 先 COPY `package*.json` 再 `npm ci`，再 COPY 源码——利用层缓存，
  只改源码时不必重装依赖；
- 运行阶段不含 node/npm，镜像体积与攻击面都小；
- `EXPOSE 80`，`CMD` 用 nginx 默认前台启动。

#### nginx.conf

| 配置 | 目的 |
|---|---|
| `try_files $uri $uri/ /index.html` | SPA 前端路由回落，刷新 `/chat/xxx` 不会 404 |
| `gzip on` + 类型列表 | JS/CSS/SVG 压缩（woff2 已自带压缩，无需列入） |
| `/assets/` 长缓存 `immutable` | Vite 产物带内容哈希，可安全缓存一年 |
| `index.html` `no-cache` | 保证每次拿到最新的资源引用 |
| `error_page 404` 回落 | 与 `try_files` 配合，避免空白页 |
| 隐藏 `server_tokens` | 不暴露 nginx 版本 |
| 安全响应头 | `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` |

**关于 API 代理**：本应用是浏览器直连 `api.deepseek.com`，API Key 存在用户
`localStorage`。因此 nginx **不做** API 反代（反代需要把 Key 放在服务端，与
「无后端、Key 不出浏览器」的设计冲突）。若目标环境无法直连外网，需自行加
`proxy_pass` 并接受 Key 经服务端转发的后果，这一点写进 README 供部署者决策。

#### .dockerignore

排除 `node_modules`、`dist`、`.git`、`.pdm`、`doc`、`scripts`，减小构建上下文。

### 四、子路径部署

若部署在 `https://host/chat/` 而非根路径，Vite 需要 `base: '/chat/'`。
当前 `vite.config.ts` 未设 `base`，默认 `/`，资源引用为绝对路径。
本次**不**改 `base`（保持根路径部署的默认行为），但把 `base` 的作用写进
README，部署者按需调整即可——这比预先猜一个子路径更安全。

## 影响

- 观感变化：正文不再是霞鹜文楷。
- 仓库体积：−9.8MB；`dist` 从 11MB 降到约 1.1MB；镜像内不含字体。
- 首屏：少两个字体 preload 请求，无字体下载。
- 对外行为：无变化，纯静态资源与样式变量调整。
- 新增部署能力：`docker build` 一条命令产出可运行的 nginx 镜像。

## 验证方式

1. `npm run build` 成功，`dist/` 下不含 `fonts/`；
2. `dist/index.html` 中无 `as="font"` 的 preload；
3. `docker build` 成功，容器起在 80 端口；
4. `curl -I http://localhost:8080/` → 200 且 `Cache-Control: no-cache`；
5. `curl -I http://localhost:8080/assets/<hash>.js` → 200 且 `immutable`；
6. `curl -o /dev/null -w '%{http_code}' http://localhost:8080/some/route` → 200
   （SPA 回落）；
7. 浏览器打开，DevTools Network 过滤 `font`，应无字体请求，正文正常显示。
