#!/usr/bin/env node
/**
 * doc/html 系统文档的合规校验。
 *
 * 回答四个问题（对应 doc/feat/architecture-html.md「验收」）：
 *  1. 覆盖度：src/ 下每个源文件是否都在文档里出现过（新增文件忘写 → 红）；
 *  2. 死链：所有本地 href 指向的文件是否真实存在；
 *  3. 锚点：page.html#anchor 形式的目标页是否存在该 id；
 *  4. 离线：页面不得引用任何外部 URL（CDN 防回归）。
 *
 * 用法：node scripts/test-doc-html.cjs
 * 纯 Node，无浏览器依赖，毫秒级。
 */
"use strict"

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const SRC_DIR = path.join(ROOT, "src")
const DOC_DIR = path.join(ROOT, "doc", "html")

let failed = 0
/** 收集失败项，最后统一打印，避免第一条失败就中断 */
const errors = []

function fail(msg) {
  failed++
  errors.push(msg)
}

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

/* ---------------- 收集源文件 ---------------- */

/** 递归列出 src/ 下所有 .ts / .tsx，返回相对仓库根的 POSIX 路径 */
function walkSrc(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkSrc(abs))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(ROOT, abs).split(path.sep).join("/"))
    }
  }
  return out.sort()
}

/* ---------------- 收集文档页面 ---------------- */

function listHtmlPages() {
  if (!fs.existsSync(DOC_DIR)) {
    fail(`文档目录不存在：doc/html/`)
    return []
  }
  const pages = fs
    .readdirSync(DOC_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort()
  if (pages.length === 0) fail("doc/html/ 下没有任何 .html 页面")
  return pages
}

/** 页面文件名 → 清洗后的 HTML 文本（供后续所有断言使用） */
function readPages(pages) {
  const map = new Map()
  for (const p of pages) {
    map.set(p, fs.readFileSync(path.join(DOC_DIR, p), "utf8"))
  }
  return map
}

/** 抽取页面里所有 id="..."（用于跨页锚点校验） */
function idsOf(html) {
  const ids = new Set()
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1])
  return ids
}

/** 抽取所有 href="..."，排除纯锚点 "#x" 之外全部返回 */
function hrefsOf(html) {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
}

/* ---------------- 断言 1：覆盖度 ---------------- */

function checkCoverage(pages, pageMap) {
  const sources = walkSrc(SRC_DIR)
  if (sources.length === 0) {
    fail("src/ 下未找到任何 .ts/.tsx 文件，路径可能不对")
    return
  }
  const allHtml = [...pageMap.values()].join("\n")
  const missing = sources.filter((rel) => !allHtml.includes(rel))

  if (missing.length) {
    fail(
      `有 ${missing.length} 个源文件未出现在文档中（新增文件需同步更新 doc/html）：\n` +
        missing.map((m) => `      - ${m}`).join("\n")
    )
  } else {
    ok(`覆盖度：src/ 全部 ${sources.length} 个源文件均已在文档中出现`)
  }
  console.log(`    页面：${pages.join(", ")}`)
}

/* ---------------- 断言 2/3：死链与锚点 ---------------- */

function checkLinks(pages, pageMap) {
  const pageIds = new Map()
  for (const [p, html] of pageMap) pageIds.set(p, idsOf(html))

  let linkCount = 0
  for (const [page, html] of pageMap) {
    for (const href of hrefsOf(html)) {
      linkCount++
      // 纯页内锚点：本页必须存在该 id
      if (href.startsWith("#")) {
        const anchor = href.slice(1)
        if (!anchor) continue
        if (!pageIds.get(page).has(anchor)) {
          fail(`${page}: 页内锚点 #${anchor} 在本文档中不存在`)
        }
        continue
      }
      // 外部链接统一交给断言 4 处理
      if (/^(https?:)?\/\//.test(href) || href.startsWith("mailto:")) continue

      const [filePart, hash] = href.split("#")
      if (!filePart) continue
      const target = path.resolve(path.dirname(path.join(DOC_DIR, page)), filePart)

      if (!fs.existsSync(target)) {
        fail(`${page}: 链接指向不存在的文件 ${href}`)
        continue
      }
      // 跨页锚点：目标若是 HTML，校验 id
      if (hash && target.endsWith(".html")) {
        const targetName = path.basename(target)
        const targetHtml = pageMap.get(targetName)
        if (targetHtml && !idsOf(targetHtml).has(hash)) {
          fail(`${page}: 链接 ${href} 的锚点 #${hash} 在 ${targetName} 中不存在`)
        }
      }
    }
  }
  ok(`链接与锚点：共检查 ${linkCount} 个 href，无死链`)
}

/* ---------------- 断言 4：无外部依赖 ---------------- */

function checkOffline(pages, pageMap) {
  for (const [page, html] of pageMap) {
    // 只看真正会发起请求的位置：src= / href= / url() / @import
    const offenders = []
    for (const m of html.matchAll(/\s(src|href)="((?:https?:)?\/\/[^"]*)"/g)) {
      offenders.push(`${m[1]}="${m[2]}"`)
    }
    for (const m of html.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^)'"]*)/g)) {
      offenders.push(`url(${m[1]})`)
    }
    for (const m of html.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      if (!m[1].startsWith("data:")) offenders.push(`@import ${m[1]}`)
    }
    if (offenders.length) {
      fail(`${page}: 存在外部依赖（文档必须离线可读）：\n` +
        offenders.map((o) => `      - ${o}`).join("\n"))
    }
  }
  // 样式脚本也必须在本地
  const css = path.join(DOC_DIR, "assets", "doc.css")
  const js = path.join(DOC_DIR, "assets", "doc.js")
  if (!fs.existsSync(css)) fail("缺少 doc/html/assets/doc.css")
  if (!fs.existsSync(js)) fail("缺少 doc/html/assets/doc.js")
  ok("离线：无外部 CDN 引用，样式与脚本均为本地文件")
}

/* ---------------- 断言 5：页面结构 ---------------- */

function checkStructure(pages, pageMap) {
  for (const [page, html] of pageMap) {
    if (!/<h1[\s>]/.test(html)) fail(`${page}: 缺少 <h1> 标题`)
    if (!/<nav[\s>]/.test(html)) fail(`${page}: 缺少 <nav> 目录（JS 失效时仍要能导航）`)
    // 原生 a 标签构成目录：至少要有指向其它页面的链接
    const internal = hrefsOf(html).filter((h) => h.endsWith(".html") || h.includes(".html#"))
    if (internal.length === 0) fail(`${page}: 没有任何指向其它页面的链接，无法作为导航页`)
  }
  ok(`结构：${pages.length} 个页面均有 h1 / nav / 互链`)
}

/* ---------------- 断言 6：锚点可达性 ---------------- */

/**
 * 「id 存在」不等于「能从某处到达」。
 *
 * 教训（见 doc/feat/architecture-html.md）：早期版本里 47 个模块卡片的 id 都在，
 * 但侧栏目录只从 h2/h3 抽取，模块一个都点不到——前五条断言全绿。
 * 这里反向校验：每个模块卡片锚点至少被一条内联链接指向。
 */
function checkAnchorReachability(pageMap) {
  // 页面 → 被内联链接引用的 id 集合
  const reachable = new Map()
  for (const name of pageMap.keys()) reachable.set(name, new Set())

  for (const [page, html] of pageMap) {
    for (const href of hrefsOf(html)) {
      if (href.startsWith("#") && href.length > 1) {
        reachable.get(page).add(href.slice(1))
      } else if (href.includes(".html#")) {
        const [filePart, hash] = href.split("#")
        const target = filePart.replace(/^.*\//, "")
        if (reachable.has(target) && hash) reachable.get(target).add(hash)
      }
    }
  }

  let checked = 0
  for (const [page, html] of pageMap) {
    // 只校验模块卡片：<div class="card" id="m-xxx"> 与 <div class="card" ... id="...">
    for (const m of html.matchAll(/<div\s+([^>]*)>/g)) {
      const attrs = m[1]
      if (!/class="[^"]*\bcard\b/.test(attrs)) continue
      const idMatch = attrs.match(/id="([^"]+)"/)
      if (!idMatch) continue
      const id = idMatch[1]
      checked++
      if (!reachable.get(page).has(id)) {
        fail(`${page}: 模块锚点 #${id} 存在但无任何链接指向，无法从页面到达`)
      }
    }
  }
  ok(`可达性：${checked} 个模块卡片锚点均有链接指向`)
}

/* ---------------- 断言 7：索引表可机械校验 ---------------- */

function checkIndexTable(pageMap) {
  const index = pageMap.get("index.html")
  if (!index) {
    fail("缺少 index.html")
    return
  }
  // 索引表里每个模块名应是可点击链接（指向 modules.html#id）
  const tableLinks = [...index.matchAll(/href="modules\.html#([^"]+)"/g)].map((m) => m[1])
  if (tableLinks.length < 20) {
    fail(`index.html 的模块索引表只有 ${tableLinks.length} 条入口，预期覆盖全部模块`)
  } else {
    ok(`索引表：index.html 提供 ${tableLinks.length} 个指向 modules.html 的模块入口`)
  }
}

/* ---------------- 主流程 ---------------- */

console.log("doc/html 系统文档校验\n")

const pages = listHtmlPages()
if (pages.length > 0) {
  const pageMap = readPages(pages)
  checkCoverage(pages, pageMap)
  checkLinks(pages, pageMap)
  checkOffline(pages, pageMap)
  checkStructure(pages, pageMap)
  checkAnchorReachability(pageMap)
  checkIndexTable(pageMap)
}

console.log("")
if (failed > 0) {
  console.error(`✗ ${failed} 项校验失败：\n`)
  for (const e of errors) console.error(`  - ${e}\n`)
  process.exit(1)
}
console.log("✓ 全部校验通过")
