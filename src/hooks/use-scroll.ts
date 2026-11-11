import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 智能贴底滚动：用户没有手动上滚时自动跟随到底部。
 */
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinned.current = distance < 80
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [onScroll])

  useEffect(() => {
    const el = ref.current
    if (!el || !pinned.current) return
    el.scrollTop = el.scrollHeight
  }, [dep])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [])

  const isPinned = () => pinned.current

  return { ref, scrollToBottom, isPinned }
}

export function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 200
) {
  const [rows, setRows] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    const next = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${next}px`
    setRows(next > 48 ? 3 : 1)
  }, [value, ref, maxHeight])
  return rows
}

/**
 * 监听消息区内的文本选区，返回选中内容与其所属消息。
 * 需要消息元素带 data-message-id 属性。
 */
export function useSelectionWatcher(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  const [selection, setSelection] = useState<{
    text: string
    messageId: string
    rect: { top: number; left: number; width: number; height: number }
  } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setSelection(null)
      return
    }

    let raf = 0
    const update = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""

      if (!sel || sel.rangeCount === 0 || !text) {
        setSelection(null)
        return
      }

      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement)
          : node.parentElement

      // 必须落在消息容器内，且不能在输入框里
      if (!el || !containerRef.current?.contains(el)) {
        setSelection(null)
        return
      }
      if (el.closest("textarea, input")) {
        setSelection(null)
        return
      }

      const holder = el.closest("[data-message-id]") as HTMLElement | null
      if (!holder) {
        setSelection(null)
        return
      }

      const r = range.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        setSelection(null)
        return
      }

      setSelection({
        text,
        messageId: holder.dataset.messageId!,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      })
    }

    const onSelectionChange = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }

    document.addEventListener("selectionchange", onSelectionChange)
    // 滚动时重新计算位置
    const scroller = containerRef.current
    scroller?.addEventListener("scroll", onSelectionChange, { passive: true })
    window.addEventListener("resize", onSelectionChange)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("selectionchange", onSelectionChange)
      scroller?.removeEventListener("scroll", onSelectionChange)
      window.removeEventListener("resize", onSelectionChange)
    }
  }, [containerRef, enabled])

  const clear = () => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return { selection, clear }
}
