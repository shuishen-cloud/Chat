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
