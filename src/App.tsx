import { useEffect, useState } from "react"
import { Moon, PanelLeft, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatSidebar } from "@/components/chat-sidebar"
import { ChatMain } from "@/components/chat-main"
import { BoardPanel } from "@/components/board-panel"
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
  const history = usePromptHistory(store.state.conversations)
  /** 点历史项时填入输入框 */
  const [draft, setDraft] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /** 画板面板开合，与对话视图互不排斥 */
  const [boardOpen, setBoardOpen] = useState(() => store.state.mainView === "board")
  /** 画板宽度：纯 UI 偏好，独立于 ChatState 持久化 */
  const [boardWidth, setBoardWidth] = useState(readBoardWidth)

  /** 拖拽分隔条调整宽度 */
  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = boardWidth
    const onMove = (ev: MouseEvent) => {
      // 画板在右侧：鼠标左移 → 变宽
      const next = startWidth - (ev.clientX - startX)
      setBoardWidth(clampBoardWidth(next))
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  // 宽度持久化
  useEffect(() => {
    localStorage.setItem("shadcn-chat/board-width", String(boardWidth))
  }, [boardWidth])
  const { dark, toggle } = useTheme()

  // 让 store 能触发设置对话框
  useEffect(() => {
    store.registerOpenSettings(() => setSettingsOpen(true))
  }, [store])

  // store 侧的 mainView 变化（如侧边栏点画板）同步到面板开合
  useEffect(() => {
    setBoardOpen(store.state.mainView === "board")
  }, [store.state.mainView])

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

          <div className="flex min-h-0 flex-1">
            {/*
             * 对话与画板并排，而不是互斥切换。
             * 互斥会逼着用户先关画板才能换会话，打断「边看对话边整理」的主流程。
             */}
            <div className="min-w-0 flex-1">
              <ChatMain
                store={store}
                onOpenSettings={() => setSettingsOpen(true)}
                history={history}
                draft={draft}
                onDraftConsumed={() => setDraft("")}
              />
            </div>

            {boardOpen && (
              <>
                {/* 拖拽分隔条：调整画板宽度，双击复位 */}
                <div
                  data-board-resizer
                  role="separator"
                  aria-orientation="vertical"
                  title="拖拽调整宽度，双击复位"
                  onMouseDown={startResize}
                  onDoubleClick={() => setBoardWidth(DEFAULT_BOARD_WIDTH)}
                  className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/50"
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                </div>
                <div
                  data-board-panel
                  style={{ width: boardWidth }}
                  className="flex shrink-0 flex-col border-l border-border"
                >
                  <ErrorBoundary label="画板" resetKey={store.state.activeBoardId}>
                    <BoardPanel
                      store={store}
                      onClose={() => setBoardOpen(false)}
                      maximized={boardWidth >= MAX_BOARD_WIDTH - 1}
                      onToggleMaximize={() =>
                        setBoardWidth((w) =>
                          w >= MAX_BOARD_WIDTH - 1 ? DEFAULT_BOARD_WIDTH : MAX_BOARD_WIDTH
                        )
                      }
                    />
                  </ErrorBoundary>
                </div>
              </>
            )}
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
          conversationId={store.state.activeConversationId}
          conversationTitle={store.activeConversation?.title ?? null}
          onPick={(text) => setDraft(text)}
        />
        <Toaster position="top-center" richColors />
      </div>
    </TooltipProvider>
  )
}

/* ---------------- 画板宽度 ---------------- */

const DEFAULT_BOARD_WIDTH = 620
const MIN_BOARD_WIDTH = 360
const MAX_BOARD_WIDTH = 900
const BOARD_WIDTH_KEY = "shadcn-chat/board-width"

/** 限制在上下界内，同时不超过窗口的 70%，保证对话区still可用 */
function clampBoardWidth(width: number): number {
  const cap = Math.min(MAX_BOARD_WIDTH, Math.round(window.innerWidth * 0.7))
  return Math.min(Math.max(width, MIN_BOARD_WIDTH), Math.max(cap, MIN_BOARD_WIDTH))
}

function readBoardWidth(): number {
  const raw = localStorage.getItem(BOARD_WIDTH_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? clampBoardWidth(n) : DEFAULT_BOARD_WIDTH
}
