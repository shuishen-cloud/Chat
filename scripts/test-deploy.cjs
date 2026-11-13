#!/usr/bin/env node
/**
 * 部署产物校验（字体降级 + Nginx/Docker）。
 *
 * 与 scripts/test-*.cjs 的 Playwright 用例不同：这里不做浏览器交互，
 * 只检查「构建产物」与「部署配置」这两类静态事实，因此不需要启动 dev server。
 *
 * 用法：
 *   node scripts/test-deploy.cjs          # 跑全部
 *   CASE=buildArtifacts node scripts/test-deploy.cjs
 *   CASE=--list node scripts/test-deploy.cjs
 *
 * 前置：先跑一次 `npm run build`（buildArtifacts / noFontPreload 依赖 dist/）。
 */

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
const exists = (p) => fs.existsSync(path.join(ROOT, p))

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const cases = {
  /** 字体目录已从仓库与 public 中移除 */
  fontsRemoved() {
    assert(!exists("public/fonts"), "public/fonts 仍存在，应整体删除")
    const css = read("src/index.css")
    assert(!/@font-face/.test(css), "index.css 仍含 @font-face")
    assert(
      !/url\(\s*['"]?\/?fonts\//.test(css),
      "index.css 仍引用 fonts/ 资源",
    )
  },

  /** 字体变量为纯系统栈，且以通用族收尾 */
  systemFontStack() {
    const css = read("src/index.css")
    const sans = css.match(/--font-sans:\s*([^;]+);/)
    const mono = css.match(/--font-mono:\s*([^;]+);/)
    assert(sans, "未找到 --font-sans 定义")
    assert(mono, "未找到 --font-mono 定义")

    // 不得再出现自托管字体名
    for (const name of ["LXGW WenKai", "Fira Code"]) {
      assert(!sans[1].includes(name), `--font-sans 仍引用 ${name}`)
      assert(!mono[1].includes(name), `--font-mono 仍引用 ${name}`)
    }

    // 系统字体优先，并以通用族兜底
    assert(/system-ui|system-ui\s*,/.test(sans[1]), "--font-sans 未用 system-ui 优先")
    assert(/sans-serif\s*$/.test(sans[1].trim()), "--font-sans 未以 sans-serif 收尾")
    assert(/monospace\s*$/.test(mono[1].trim()), "--font-mono 未以 monospace 收尾")
    assert(sans[1].includes("PingFang SC"), "--font-sans 缺 macOS 中文字体")
    assert(sans[1].includes("Microsoft YaHei"), "--font-sans 缺 Windows 中文字体")
  },

  /** index.html 不再预加载字体 */
  noFontPreload() {
    for (const file of ["index.html", "dist/index.html"]) {
      if (!exists(file)) continue
      const html = read(file)
      assert(!/as=["']font["']/.test(html), `${file} 仍含字体 preload`)
      assert(!/fonts\//.test(html), `${file} 仍引用 fonts/`)
    }
  },

  /** 构建产物中不含字体文件 */
  buildArtifacts() {
    assert(exists("dist"), "dist/ 不存在，请先 npm run build")
    const walk = (dir) => {
      const out = []
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...walk(p))
        else out.push(p)
      }
      return out
    }
    const files = walk(path.join(ROOT, "dist"))
    const fontFiles = files.filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f))
    assert(
      fontFiles.length === 0,
      `dist 仍含字体文件：${fontFiles.map((f) => path.relative(ROOT, f)).join(", ")}`,
    )

    const total = files.reduce((s, f) => s + fs.statSync(f).size, 0)
    // 字体删除后 dist 应在 2MB 以内；留余量防误报
    assert(total < 2 * 1024 * 1024, `dist 体积 ${(total / 1048576).toFixed(2)}MB，超出 2MB 预算`)
  },

  /** .gitignore 不再保留字体相关规则 */
  gitignoreClean() {
    const gi = read(".gitignore")
    const stale = gi
      .split("\n")
      .filter((l) => l.trim().startsWith("public/fonts"))
    assert(stale.length === 0, `.gitignore 仍含过期字体规则：${stale.join(" | ")}`)
  },

  /** Dockerfile 存在且为多阶段构建 */
  dockerfile() {
    assert(exists("Dockerfile"), "缺少 Dockerfile")
    const df = read("Dockerfile")
    const stages = df.match(/^FROM\s+/gim) || []
    assert(stages.length >= 2, "Dockerfile 应为多阶段构建")
    assert(/AS\s+builder/i.test(df), "Dockerfile 缺 builder 阶段")
    assert(/npm ci/.test(df), "Dockerfile 应用 npm ci 保证可复现")
    assert(/COPY --from=builder/i.test(df), "Dockerfile 未从 builder 拷贝产物")
    /*
     * 已从 nginx 单容器切到 Node 单容器（feat: remote-state-sync）：
     * 对话状态需要一个常驻进程读写，nginx 只能发静态文件。
     */
    assert(/EXPOSE\s+3000/.test(df), "Dockerfile 未 EXPOSE 3000")
    assert(/node:22-alpine/.test(df), "运行阶段应基于 node:22-alpine")
    assert(/server\/index\.ts/.test(df), "Dockerfile 未启动服务端")
    // 状态文件必须挂在卷上，否则容器重建丢全部对话
    assert(/VOLUME\s+\["\/app\/data"\]/.test(df), "Dockerfile 未为状态目录声明 VOLUME")
    assert(/STATE_FILE=\/app\/data\/state\.json/.test(df), "Dockerfile 未固定 STATE_FILE")
  },

  /** 服务端提供 SPA 回落与差异化缓存（原 nginx.conf 的职责） */
  serverRouting() {
    assert(exists("server/index.ts"), "缺少 server/index.ts")
    const srv = read("server/index.ts")
    assert(/\/api\/state/.test(srv), "服务端缺 /api/state 路由")
    assert(/\/api\/health/.test(srv), "服务端缺 /api/health 路由")
    assert(/max-age=31536000, immutable/.test(srv), "/assets/ 缺 immutable 长缓存")
    assert(/no-cache, must-revalidate/.test(srv), "index.html 缺 no-cache")
    assert(/startsWith\("\/api\/"\)/.test(srv), "未知 /api/ 路径不应回落到 HTML")
  },

  /** .dockerignore 排除构建无关目录 */
  dockerignore() {
    assert(exists(".dockerignore"), "缺少 .dockerignore")
    const di = read(".dockerignore")
    for (const dir of ["node_modules", "dist", ".git"]) {
      assert(
        di.split("\n").some((l) => l.trim().replace(/\/$/, "") === dir),
        `.dockerignore 未排除 ${dir}`,
      )
    }
  },

  /** README 已同步字体变更并补部署说明 */
  readme() {
    const md = read("README.md")
    assert(!/自托管字体/.test(md), "README 仍宣传自托管字体")
    assert(!/霞鹜文楷/.test(md), "README 仍提霞鹜文楷")
    assert(/docker build/i.test(md), "README 缺 docker build 说明")
    assert(/数据卷|volume/i.test(md), "README 缺数据卷说明")
  },
}

function main() {
  const only = process.env.CASE
  if (only === "--list") {
    console.log(Object.keys(cases).join("\n"))
    return
  }
  const names = only ? [only] : Object.keys(cases)
  if (only && !cases[only]) {
    console.error(`未知用例：${only}`)
    console.error(`可用：${Object.keys(cases).join(", ")}`)
    process.exit(2)
  }

  let failed = 0
  for (const name of names) {
    try {
      cases[name]()
      console.log(`  ✓ ${name}`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${name}\n      ${e.message}`)
    }
  }
  console.log(
    `\n${names.length - failed}/${names.length} 通过${failed ? `，${failed} 失败` : ""}`,
  )
  process.exit(failed ? 1 : 0)
}

main()
