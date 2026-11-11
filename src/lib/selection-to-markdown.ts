/**
 * 把 DOM 选区还原成 Markdown。
 *
 * 为什么不直接用 `selection.toString()`：
 *  - 表格里浏览器会用 \t 连接单元格，丢失表头/分隔行，粘到别处完全没法看；
 *  - 代码块里依赖 DOM 文本节点拼接，缩进、空行、以及高亮拆出来的 span 都会失真；
 *  - 列表、引用、链接也会退化成纯文本。
 * 这里按节点类型重新序列化，保证「选什么就是什么」。
 *
 * 注意：本文件只依赖标准 DOM，不依赖 React。
 */

/** 块级标签，前后补换行 */
const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "BLOCKQUOTE",
  "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TBODY", "THEAD", "TR", "PRE", "HR",
])

function isBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName)
}

/** 序列化代码块：保留原始换行与缩进 */
function serializePre(pre: Element): string {
  // 代码块里通常还有 <code>，取最内层整块文本
  const raw = pre.textContent ?? ""
  const lang =
    pre.querySelector("code")?.className?.match(/language-([\w-]+)/)?.[1] ?? ""
  const body = raw.replace(/\n+$/, "")
  return `\n\`\`\`${lang}\n${body}\n\`\`\`\n`
}

/** 序列化表格：还原成 Markdown 表格，保留表头 */
function serializeTable(table: Element): string {
  const rows = [...table.querySelectorAll("tr")]
  if (rows.length === 0) return ""

  const cellsOf = (row: Element) =>
    [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) =>
      // 单元格内的换行压成空格，避免破坏表格结构
      (cell.textContent ?? "").replace(/\s+/g, " ").trim()
    )

  const first = cellsOf(rows[0])
  const hasHeader = !!rows[0].querySelector("th")
  const header = hasHeader ? first : first.map((_, i) => `列${i + 1}`)
  const body = hasHeader ? rows.slice(1) : rows

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((r) => {
      const cells = cellsOf(r)
      // 补齐列数，防止 rowspan/colspan 导致表格错位
      while (cells.length < header.length) cells.push("")
      return `| ${cells.slice(0, header.length).join(" | ")} |`
    }),
  ]
  return `\n${lines.join("\n")}\n`
}

function serializeList(list: Element, depth = 0): string {
  const ordered = list.tagName === "OL"
  const indent = "  ".repeat(depth)
  const items = [...list.querySelectorAll(":scope > li")]
  const lines: string[] = []

  items.forEach((li, i) => {
    // 只取 li 的直接文本内容，子列表单独递归，避免重复
    const clone = li.cloneNode(true) as Element
    clone.querySelectorAll(":scope > ul, :scope > ol").forEach((n) => n.remove())
    const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim()
    const bullet = ordered ? `${i + 1}.` : "-"
    lines.push(`${indent}${bullet} ${text}`)

    li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => {
      lines.push(serializeList(sub, depth + 1).replace(/\n$/, ""))
    })
  })

  return `${lines.join("\n")}\n`
}

/**
 * 序列化时应当被忽略的 UI 元素。
 *
 * 代码块的「复制」按钮和 pre 是兄弟节点，同在一个 wrapper div 里。
 * 整条消息全选时，顶层块就是这个 wrapper，会直接走 serializeBlock -> serializeChildren，
 * 而那条路径不再经过 walk 的 isUiChrome 检查，于是按钮文案会被当成正文。
 * 因此过滤必须放在序列化的最内层统一做。
 */
function isUiChromeElement(el: Element): boolean {
  return (
    el.tagName === "BUTTON" ||
    el.tagName === "SVG" ||
    el.getAttribute("aria-hidden") === "true" ||
    !!el.closest("[data-ui-chrome]") ||
    // 历史遗留类名，保留兼容
    el.classList.contains("code-copy")
  )
}

/** 行内元素序列化 */
function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // 折叠空白，但保留单个空格
    return (node.textContent ?? "").replace(/\s+/g, " ")
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ""

  const el = node as Element
  // UI 文案（复制按钮等）不进 Markdown
  if (isUiChromeElement(el)) return ""

  const tag = el.tagName
  const inner = () => serializeChildren(el)

  switch (tag) {
    case "STRONG":
    case "B":
      return `**${inner().trim()}**`
    case "EM":
    case "I":
      return `*${inner().trim()}*`
    case "DEL":
    case "S":
      return `~~${inner().trim()}~~`
    case "CODE":
      return `\`${el.textContent ?? ""}\``
    case "A": {
      const href = el.getAttribute("href") ?? ""
      const text = inner().trim()
      return href ? `[${text}](${href})` : text
    }
    case "BR":
      return "\n"
    default:
      return inner()
  }
}

function serializeChildren(el: Element): string {
  return [...el.childNodes].map(serializeInline).join("")
}

/** 块级元素序列化 */
function serializeBlock(el: Element): string {
  const tag = el.tagName

  if (tag === "PRE") return serializePre(el)
  if (tag === "TABLE") return serializeTable(el)
  if (tag === "UL" || tag === "OL") return `\n${serializeList(el)}`
  if (tag === "HR") return "\n---\n"

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    return `\n${"#".repeat(level)} ${serializeChildren(el).trim()}\n`
  }

  if (tag === "BLOCKQUOTE") {
    const text = (el as HTMLElement).innerText.trim()
    return `\n${text
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n")}\n`
  }

  if (tag === "LI") {
    // 单独选到 li 时退化处理
    return `${serializeChildren(el).trim()}\n`
  }

  /*
   * 关键：容器 div（如代码块的 wrapper）里如果嵌了结构性元素，
   * 必须逐个序列化，否则 `pre` 会被当成普通行内内容，
   * 退化成「用反引号包起来的代码」而不是围栏代码块。
   */
  if (el.querySelector("table, pre, ul, ol")) {
    const parts: string[] = []
    for (const child of [...el.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element
        if (isUiChromeElement(childEl)) continue
        if (isBlock(childEl)) {
          parts.push(serializeBlock(childEl))
        } else {
          parts.push(serializeInline(childEl))
        }
      } else {
        parts.push(serializeInline(child))
      }
    }
    return parts.join("")
  }

  const text = serializeChildren(el).replace(/[ \t]+\n/g, "\n").trim()
  return text ? `\n${text}\n` : ""
}

/**
 * 序列化一个 Range（选区）为 Markdown。
 *
 * 核心难点是「部分选区」：用户可能只选表格里两行、或从表格中间选到代码块中间。
 * 做法是把 Range 拆成若干完整节点 + 最多两个部分节点（首、尾），
 * 再按节点类型分别序列化，避免退化成一坨粘连文字。
 */
export function rangeToMarkdown(range: Range): string {
  const container = range.commonAncestorContainer
  const root =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : (container.parentElement as Element)
  if (!root) return ""

  const out: string[] = []

  /** 代码块里的「复制」按钮等 UI 文案不应进入选区结果 */
  const isUiChrome = isUiChromeElement

  /** 整块输出用的结构元素：表格 / 代码块 / 列表 */
  const STRUCT_TAGS = new Set(["TABLE", "PRE", "UL", "OL"])

  /** 选区是否覆盖整个元素的全部内容（含「选中元素内部全部内容」的情形） */
  const coversContentsOf = (el: Element) => {
    try {
      const elRange = document.createRange()
      elRange.selectNode(el)
      const coversWhole =
        range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0
      if (coversWhole) return true
      // selectNodeContents 的情形：选区边界落在元素自身的起始/结束位置
      return (
        range.startContainer === el && range.startOffset === 0 &&
        range.endContainer === el && range.endOffset === el.childNodes.length
      )
    } catch {
      return false
    }
  }

  /**
   * 判断 el 是否被选区「完整」包含：
   * 用与 el 等价的 Range 比对边界，比字符串包含更可靠。
   */
  const fullyContained = (el: Element) => coversContentsOf(el)

  /** 元素与选区无交集 */
  const disjoint = (el: Element) => {
    try {
      return !range.intersectsNode(el)
    } catch {
      return true
    }
  }

  /** 从 el 中截取与选区相交的那部分文本（用于部分选中的单元格/代码） */
  const clippedText = (el: Element) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    try {
      if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) {
        r.setStart(range.startContainer, range.startOffset)
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) {
        r.setEnd(range.endContainer, range.endOffset)
      }
    } catch {
      /* 边界不可比时退化为整体 */
    }
    return r.toString()
  }

  const walk = (el: Element) => {
    if (disjoint(el)) return
    if (isUiChrome(el)) return

    const tag = el.tagName

    // 结构性元素：完整包含就整块序列化，否则逐个单元格/行退化处理
    if (STRUCT_TAGS.has(tag)) {
      if (fullyContained(el)) {
        if (tag === "PRE") out.push(serializePre(el))
        else if (tag === "TABLE") out.push(serializeTable(el))
        else out.push(`\n${serializeList(el)}`)
        return
      }
      // 部分选中表格：只输出被选中的行，保持表头
      if (tag === "TABLE") {
        const rows = [...el.querySelectorAll("tr")].filter((r) => !disjoint(r))
        if (rows.length > 0) {
          // 单元格保留完整文本：截半个格子在 Markdown 表格里没有意义，
          // 反而会丢掉被选区边界切掉的那部分内容
          const cellsOf = (row: Element) =>
            [...row.querySelectorAll(":scope > th, :scope > td")].map((c) =>
              (c.textContent ?? "").replace(/\s+/g, " ").trim()
            )
          // 表头取完整文本：即使数据行只选中一部分，也要让结果能读
          const headerRow = el.querySelector("tr")
          const header = headerRow
            ? [...headerRow.querySelectorAll(":scope > th, :scope > td")].map((c) =>
                (c.textContent ?? "").trim()
              )
            : (cellsOf(rows[0]) as string[])
          const lines = [
            `| ${header.join(" | ")} |`,
            `| ${header.map(() => "---").join(" | ")} |`,
            ...rows
              .filter((r) => r !== headerRow || rows.length === 1)
              .map((r) => {
                const cells = cellsOf(r)
                while (cells.length < header.length) cells.push("")
                return `| ${cells.slice(0, header.length).join(" | ")} |`
              }),
          ]
          out.push(`\n${lines.join("\n")}\n`)
        }
        return
      }
      // 部分选中代码块：只取相交文本，保留换行
      if (tag === "PRE") {
        out.push(`\n\`\`\`\n${clippedText(el).replace(/\n+$/, "")}\n\`\`\`\n`)
        return
      }
      // 部分选中列表：递归到 li
      for (const child of [...el.children]) walk(child as Element)
      return
    }

    if (isBlock(el)) {
      // 整块被选中时走块级序列化
      if (fullyContained(el)) {
        out.push(serializeBlock(el))
        return
      }
      // 否则递归子节点，交给下面的行内/块级分流
      let inlineBuffer = ""
      const flushInline = () => {
        const t = inlineBuffer.replace(/[ \t]+/g, " ").trim()
        if (t) out.push(t)
        inlineBuffer = ""
      }
      for (const child of [...el.childNodes]) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child as Element
          if (isUiChrome(childEl)) continue
          if (isBlock(childEl) || STRUCT_TAGS.has(childEl.tagName)) {
            flushInline()
            walk(childEl)
          } else {
            inlineBuffer += serializeInline(childEl)
          }
        } else {
          inlineBuffer += serializeInline(child)
        }
      }
      flushInline()
      return
    }

    // 行内元素
    out.push(serializeInline(el))
  }

  /*
   * 关键：不能无条件从 root 开始 walk。
   * 当选区只是消息正文里的一小段时，root 往往是整条 .prose-chat，
   * 直接遍历会把整条消息都序列化出来。
   *
   * 做法：找出「与选区相交、且不与任何祖先兄弟相交」的那些块作为起点。
   * 从 root 逐层向下走，凡是仍与选区相交的子节点就继续深入，
   * 直到某个子节点的兄弟都不相交 —— 这些节点就是本次选区的顶层块。
   */
  const topLevelBlocks = (el: Element): Element[] => {
    const kids = [...el.children] as Element[]
    if (kids.length === 0) return [el]

    // 找出与选区相交的子节点
    const hit = kids.filter((k) => !disjoint(k))
    if (hit.length === 0) return [el]

    // 只有一个子节点命中，且它不是唯一的子节点 -> 继续下钻，
    // 这样就不会把「唯一的那个代码块容器」整个展开（连同复制按钮）
    if (hit.length === 1) {
      const only = hit[0]
      // 结构性元素直接作为顶层块返回，不要展开（否则会带出复制按钮等 UI）
      if (STRUCT_TAGS.has(only.tagName)) return [only]
      const innerHits = [...only.children].filter(
        (k) => !disjoint(k) && !isUiChrome(k)
      )
      if (innerHits.length > 0) {
        const deeper = topLevelBlocks(only)
        if (deeper.length === 1 && deeper[0] === only) return [only]
        return deeper
      }
    }
    return hit
  }

  // 选区正好落在某个结构元素内部（如只选中整张表）时，直接整块输出
  if (STRUCT_TAGS.has(root.tagName) && coversContentsOf(root)) {
    walk(root)
  } else {
    const blocks = topLevelBlocks(root)
    for (const b of blocks) {
      if (!isUiChrome(b)) walk(b)
    }
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 判断选区是否横跨多个块级结构（表格/代码块/列表） */
export function rangeHasStructuredContent(range: Range): boolean {
  const container = range.commonAncestorContainer
  const root =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : (container.parentElement as Element)
  if (!root) return false
  return !!root.querySelector("table, pre") || /^(TABLE|PRE)$/.test(root.tagName)
}
