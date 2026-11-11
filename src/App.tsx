import { useEffect, useState } from "react"
import { Moon, PanelLeft, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatSidebar } from "@/components/chat-sidebar"
import { ChatMain } from "@/components/chat-main"
import { SettingsDialog } from "@/components/settings-dialog"
import { FavoritesPanel } from "@/components/favorites-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  PromptHistoryPanel,
  usePromptHistory,
} from "@/components/prompt-history"
import { Toaster } from "@/components/ui/sonner"
import { useChatStore } from "@/hooks/use-chat-store"
import { cn } from "@/lib/utils"

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("shadcn-chat/theme")
    if (saved) return saved === "dark"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("shadcn-chat/theme", dark ? "dark" : "light")
  }, [dark])

  return { dark, toggle: () => setDark((d) => !d) }
}

export default function App() {
  const store = useChatStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const history = usePromptHistory()
  /** 点历史项时填入输入框 */
  const [draft, setDraft] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { dark, toggle } = useTheme()

  // 让 store 能触发设置对话框
  useEffect(() => {
    store.registerOpenSettings(() => setSettingsOpen(true))
  }, [store])

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        <div
          className={cn(
            "h-full shrink-0 overflow-hidden transition-[width] duration-200",
            sidebarOpen ? "w-[280px]" : "w-0"
          )}
        >
          <ChatSidebar
            store={store}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenFavorites={() => setFavoritesOpen((v) => !v)}
          />
        </div>

        <ErrorBoundary label="收藏面板" resetKey={favoritesOpen}>
          <FavoritesPanel
            open={favoritesOpen}
            onOpenChange={setFavoritesOpen}
            store={store}
          />
        </ErrorBoundary>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setSidebarOpen((v) => !v)}
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>切换侧边栏</TooltipContent>
            </Tooltip>
            <span className="ml-1 text-xs font-medium text-muted-foreground">
              shadcn chat · DeepSeek
            </span>
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={toggle}
                  >
                    {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  </Button>
                }
              />
              <TooltipContent>{dark ? "浅色模式" : "深色模式"}</TooltipContent>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1">
            <ChatMain
              store={store}
              onOpenSettings={() => setSettingsOpen(true)}
              history={history}
              draft={draft}
              onDraftConsumed={() => setDraft("")}
            />
          </div>
        </div>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          store={store}
        />
        <PromptHistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          history={history}
          onPick={(text) => setDraft(text)}
        />
        <Toaster position="top-center" richColors />
      </div>
    </TooltipProvider>
  )
}
