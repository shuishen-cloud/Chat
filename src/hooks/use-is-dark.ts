import { useEffect, useState } from "react"

/**
 * 读取当前主题是否为暗色。
 *
 * 主题真源是 <html class="dark">（由 App 的 useTheme 维护），
 * 这里直接观察该 class，避免把主题状态层层透传。
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  )

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains("dark"))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return dark
}
