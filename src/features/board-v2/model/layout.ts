/**
 * 新卡片落点：保证不与画布上任何已有卡片重叠。
 *
 * 背景（见 doc/feat/board-branch-layout.md）：
 * 旧实现用「已有卡片数」取模算网格坐标（col = index % 3），
 * 删卡后 index 回流，新卡就直接压到现存卡片上。
 *
 * 本模块只回答一个问题：**这张卡片放哪不会碰到别人**。
 * 不做网格、不做树形、不动已有卡片——用户拖过的位置是高价值信息。
 *
 * 约束：纯函数，无 React、无 DOM、不读全局；任何输入都返回有限坐标。
 */
import type { Conversation } from "@/lib/types"

export type Rect = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }

/** 卡片之间的最小间隙 */
export const LAYOUT_GAP = 32

/** 分支相对父卡片的水平偏移 */
export const BRANCH_OFFSET_X = 320

/** 扫描上限：只用来防止主线程扫太久，不承担「找不到位置」的语义 */
const MAX_CANDIDATES = 400

/** 带 id 的卡片：用于在画布上查找 anchor 的几何 */
export type Slot = Rect & { id: string }

export type PlaceInput = {
  /** 画布上已有的卡片（只用几何） */
  cards: ReadonlyArray<Rect>
  /** 带 id 的已有卡片（与 cards 对应），用于查找 anchor */
  slots?: ReadonlyArray<Slot>
  /** 新卡片尺寸 */
  size: Size
  /** 期望贴靠的卡片 id（分支的父卡片、或同对话上一条） */
  anchor?: string | null
  /** 与 anchor 的关系：branch 向右、chain 向下 */
  relation?: "branch" | "chain"
  /** 额外要避开的矩形（同批次已排好的新卡片） */
  occupied?: ReadonlyArray<Rect>
  gap?: number
}

/* ---------------- 几何工具 ---------------- */

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback
}

function normSize(size: Size | undefined): Size {
  return {
    width: Math.max(1, finite(size?.width ?? 1, 1)),
    height: Math.max(1, finite(size?.height ?? 1, 1)),
  }
}

function normRect(r: Rect | undefined): Rect | null {
  if (!r) return null
  return {
    x: finite(r.x, 0),
    y: finite(r.y, 0),
    width: Math.max(1, finite(r.width, 1)),
    height: Math.max(1, finite(r.height, 1)),
  }
}

/** 两个矩形是否相交（共边不算） */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

function hitsAny(box: Rect, others: ReadonlyArray<Rect>): boolean {
  for (const o of others) {
    const r = normRect(o)
    if (r && overlaps(box, r)) return true
  }
  return false
}

function boxAt(p: Point, size: Size): Rect {
  return { x: p.x, y: p.y, width: size.width, height: size.height }
}

/* ---------------- 候选点 ---------------- */

/**
 * 贴靠 anchor 的候选点。
 *
 * branch：从 anchor 右侧开始，纵向逐行下移，行尽头再向右开一列。
 * chain ：从 anchor 正下方开始，垂直向下。
 *
 * 只生成候选，是否可用由调用方统一用 `hitsAny` 判定——
 * 这样「不重叠」这条规则只有一个落点。
 */
function candidatesFromAnchor(
  anchorBox: Rect,
  size: Size,
  gap: number,
  relation: "branch" | "chain"
): Point[] {
  const out: Point[] = []
  const stepY = Math.max(size.height, anchorBox.height) + gap

  if (relation === "chain") {
    for (let i = 1; i <= MAX_CANDIDATES; i++) {
      out.push({ x: anchorBox.x, y: anchorBox.y + stepY * i })
    }
    return out
  }

  const stepX = Math.max(BRANCH_OFFSET_X, anchorBox.width + gap)
  for (let col = 1; col <= 4; col++) {
    for (let row = 0; row < Math.ceil(MAX_CANDIDATES / 4); row++) {
      out.push({ x: anchorBox.x + stepX * col, y: anchorBox.y + stepY * row })
    }
  }
  return out.slice(0, MAX_CANDIDATES)
}

/**
 * 全画布扫描：从最左上角开始逐格找空位。
 *
 * 这是无 anchor 时的主干策略；「删卡后新卡不得落回旧格子」靠的就是
 * 只看现存卡片的真实坐标，而不依赖任何计数。
 */
function candidatesScan(occupied: ReadonlyArray<Rect>, size: Size, gap: number): Point[] {
  let minX = 0
  let minY = 0
  for (const r of occupied) {
    const n = normRect(r)
    if (!n) continue
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
  }

  const stepX = size.width + gap
  const stepY = size.height + gap
  const cols = Math.max(1, Math.ceil(Math.sqrt(MAX_CANDIDATES)))

  const out: Point[] = []
  for (let row = 0; out.length < MAX_CANDIDATES; row++) {
    for (let col = 0; col < cols && out.length < MAX_CANDIDATES; col++) {
      out.push({ x: minX + col * stepX, y: minY + row * stepY })
    }
  }
  return out
}

/**
 * chain 专用候选：严格向下，不横向乱钻。
 *
 * 同一条对话的消息应当像列表一样往下读；如果允许横向找空位，
 * 就会出现「第 1 条和第 2 条并排」这种打乱顺序的排法。
 */
function candidatesDown(anchorBox: Rect, size: Size, gap: number): Point[] {
  const out: Point[] = []
  const stepY = Math.max(size.height, anchorBox.height) + gap
  for (let i = 1; i <= MAX_CANDIDATES; i++) {
    out.push({ x: anchorBox.x, y: anchorBox.y + stepY * i })
  }
  return out
}

/* ---------------- 对外接口 ---------------- */

/**
 * 计算新卡片落点：**保证不与任何已有卡片重叠**。
 *
 * 策略优先级：
 *  1. 贴靠 anchor（branch 向右 / chain 向下）；
 *  2. 全画布逐格扫描；
 *  3. 候选耗尽时，在包围盒右侧新开一列继续找。
 *
 * 三种情况都要求「零重叠」。这是唯一的硬约束，其余都是手感。
 */
export function placeCard(input: PlaceInput): Point {
  const size = normSize(input.size)
  const gap = Math.max(0, finite(input.gap ?? LAYOUT_GAP, LAYOUT_GAP))

  const occupied: Rect[] = [
    ...input.cards.map((c) => normRect(c)).filter((c): c is Rect => !!c),
    ...(input.occupied ?? []).map((c) => normRect(c)).filter((c): c is Rect => !!c),
  ]

  if (occupied.length === 0) return { x: 0, y: 0 }

  const tryCandidates = (cands: Point[]): Point | null => {
    for (const p of cands) {
      if (!hitsAny(boxAt(p, size), occupied)) return p
    }
    return null
  }

  /* 1. 贴靠 anchor */
  /*
   * anchor 的几何可能来自 `slots`（已有卡片）或 `occupied`（同批已排好的新卡片），
   * 两处都查一遍，调用方只要保证自己传的那份带 id 即可。
   */
  const anchorBox = input.anchor
    ? (input.slots?.find((s) => s.id === input.anchor) ??
       (input.occupied as ReadonlyArray<Slot> | undefined)?.find((s) => s.id === input.anchor) ??
       null)
    : null
  if (anchorBox) {
    const box = normRect(anchorBox)
    if (box) {
      const relation = input.relation ?? "branch"
      const hit =
        relation === "chain"
          ? tryCandidates(candidatesDown(box, size, gap))
          : tryCandidates(candidatesFromAnchor(box, size, gap, "branch"))
      if (hit) return hit
    }
  }

  /* 2. 全画布扫描 */
  const hit = tryCandidates(candidatesScan(occupied, size, gap))
  if (hit) return hit

  /* 3. 兜底：包围盒右侧新开一列，纵向逐行找 */
  const right = Math.max(...occupied.map((r) => (normRect(r) as Rect).x + (normRect(r) as Rect).width))
  const top = Math.min(...occupied.map((r) => (normRect(r) as Rect).y))
  const stepY = size.height + gap
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const p = { x: right + gap, y: top + i * stepY }
    if (!hitsAny(boxAt(p, size), occupied)) return p
  }

  // 理论上不可达；返回有限坐标，绝不 NaN
  return { x: right + gap, y: top + MAX_CANDIDATES * stepY }
}

/* ---------------- 对话导入：提问/回答左右交错 ---------------- */

/**
 * 交错布局里左右两列的纵向错位比例。
 *
 * 0.5 会让每一行多占半张卡高，四条消息就多出近一整张卡的空白。
 * 取 0.28：错位感仍然明显（看得出左右交替），但不至于把画布拉长。
 */
export const ZIGZAG_OFFSET_Y = 0.28

/**
 * 左右两列之间的水平间距。
 *
 * 画板默认宽度只有 620px，两列卡片各 260 就吃掉 520，留给间距的余量很小。
 * 这里取 56：既能放下连线，又不至于把右列推出可视区。
 */
export const ZIGZAG_GAP_X = 40

export type ChatItem = {
  /** 消息角色：决定放左列还是右列 */
  role: "user" | "assistant"
  size: Size
}

/**
 * 导入整段对话时的落点：**提问靠左、回答靠右，纵向交错成之字形**。
 *
 * 形态（正是用户要的效果）：
 *
 * ```
 *   提问1 ⌉
 *         ⌊ 回答2
 *   提问3 ⌉      ⌊ 回答4
 *         ⌊ 回答2'
 * ```
 *
 * 规则：
 *  - `user`（提示词）固定放左列，`assistant`（回答）固定放右列；
 *  - 第 i 张的纵向位置 = i × 步长，左右列再各自错开半行，
 *    这样同一列里相邻两张不会贴着，阅读顺序沿着连线自然往下；
 *  - 左右列宽取各自最宽的那张，避免长回答把右列挤歪。
 *
 * 返回顺序与 `items` 一致。
 */
export function placeChat(input: {
  items: ReadonlyArray<ChatItem>
  cards?: ReadonlyArray<Rect>
  gap?: number
}): Point[] {
  if (input.items.length === 0) return []

  const gap = Math.max(0, finite(input.gap ?? LAYOUT_GAP, LAYOUT_GAP))
  const colWidth = { user: 0, assistant: 0 }
  for (const it of input.items) {
    const size = normSize(it.size)
    colWidth[it.role] = Math.max(colWidth[it.role], size.width)
  }

  // 左列从 0 开始，右列接在左列右侧
  const leftX = 0
  const rightX = Math.max(colWidth.user, 1) + ZIGZAG_GAP_X

  /** 每张卡片的纵向位置：按序号累加，行高取该张的高度 */
  const y: number[] = []
  let cursor = 0
  for (let i = 0; i < input.items.length; i++) {
    const size = normSize(input.items[i].size)
    // 左右列错开半张卡：交错感来自这里
    const stagger = input.items[i].role === "user" ? 0 : Math.round(size.height * ZIGZAG_OFFSET_Y)
    y[i] = cursor + stagger
    cursor += size.height + gap
  }

  const points: Point[] = input.items.map((it, i) => ({
    x: it.role === "user" ? leftX : rightX,
    y: y[i],
  }))

  /* 整体避开画布上已有卡片：整块平移，不逐张挤 */
  const cards = (input.cards ?? []).map((c) => normRect(c)).filter((c): c is Rect => !!c)
  if (cards.length === 0) return points

  const maxX = Math.max(...points.map((p) => p.x)) + Math.max(colWidth.user, colWidth.assistant)
  const height = Math.max(cursor - gap, 1)
  let offset = { x: Math.min(...cards.map((c) => c.x)), y: Math.min(...cards.map((c) => c.y)) }
  const band = (): Rect => ({ x: offset.x, y: offset.y, width: Math.max(maxX + 1, 1), height })

  for (let i = 0; i < MAX_CANDIDATES && hitsAny(band(), cards); i++) {
    offset = { x: offset.x, y: offset.y + height + gap }
  }

  return points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }))
}

/* ---------------- 分支父卡片 ---------------- */

type CardRefLike = { id: string; ref?: { conversationId: string; messageId: string } }

/**
 * 找出「这条消息的上游卡片」，用于把分支卡片贴到父卡片旁边。
 *
 * 分支对话（`Conversation.branchedFrom`）创建时**复制历史并重新分配消息 id**，
 * 所以 `branchedFrom.messageId` 指向源对话里的消息，分支里对应的是新 id。
 * 用「消息在对话里的下标」把两者对上。
 *
 * 返回 null 表示无从判断，调用方应按无 anchor 处理。
 */
export function findBranchParent(
  convId: string,
  messageId: string,
  conversations: ReadonlyArray<Conversation>,
  cards: ReadonlyArray<CardRefLike>
): string | null {
  const conv = conversations.find((c) => c.id === convId)
  const from = conv?.branchedFrom
  if (!conv || !from) return null

  const index = conv.messages.findIndex((m) => m.id === messageId)
  if (index < 0) return null

  const source = conversations.find((c) => c.id === from.conversationId)
  const upstream = source?.messages[index]
  if (!upstream) return null

  const card = cards.find(
    (c) => c.ref?.conversationId === source.id && c.ref?.messageId === upstream.id
  )
  return card?.id ?? null
}

/**
 * 同一对话里「这条消息之前、最近一条已上画板的消息」对应的卡片。
 *
 * 用作非分支消息的 anchor：按对话顺序往下排，而不是随机找空位。
 */
export function findPreviousCard(
  convId: string,
  messageId: string,
  conversations: ReadonlyArray<Conversation>,
  cards: ReadonlyArray<CardRefLike>
): string | null {
  const conv = conversations.find((c) => c.id === convId)
  if (!conv) return null
  const index = conv.messages.findIndex((m) => m.id === messageId)
  if (index < 0) return null

  const placed = new Map<string, string>()
  for (const c of cards) {
    if (c.ref?.conversationId === convId) placed.set(c.ref.messageId, c.id)
  }
  for (let i = index - 1; i >= 0; i--) {
    const hit = placed.get(conv.messages[i].id)
    if (hit) return hit
  }
  return null
}
