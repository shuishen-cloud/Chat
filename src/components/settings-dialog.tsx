import { useEffect, useState } from "react"
import { Eye, EyeOff, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DEFAULT_BASE_URL, DEFAULT_MODEL, MODELS } from "@/lib/types"
import type { ChatStore } from "@/hooks/use-chat-store"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: ChatStore
}

export function SettingsDialog({ open, onOpenChange, store }: Props) {
  const { state, updateSettings } = store
  const [apiKey, setApiKey] = useState(state.apiKey)
  const [baseUrl, setBaseUrl] = useState(state.baseUrl)
  const [model, setModel] = useState(state.model)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (open) {
      setApiKey(state.apiKey)
      setBaseUrl(state.baseUrl)
      setModel(state.model)
      setShowKey(false)
    }
  }, [open, state.apiKey, state.baseUrl, state.model])

  function save() {
    updateSettings({ apiKey, baseUrl, model })
    onOpenChange(false)
  }

  const currentLabel = MODELS.find((m) => m.value === model)?.label ?? model

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            API Key 仅保存在本机浏览器 localStorage，不会上传到任何第三方。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">DeepSeek API Key</Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            </div>
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              去 DeepSeek 平台创建 Key
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>模型</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className="w-full justify-start font-normal"
                  >
                    {currentLabel}
                  </Button>
                }
              />
              <DropdownMenuContent className="w-[--anchor-width] min-w-64" align="start">
                <DropdownMenuRadioGroup
                  value={model}
                  onValueChange={(v) => setModel(v as string)}
                >
                  {MODELS.map((m) => (
                    <DropdownMenuRadioItem key={m.value} value={m.value}>
                      {m.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex flex-col gap-1 pt-1">
              <Label htmlFor="model-id" className="text-xs text-muted-foreground">
                模型标识（可手动修改）
              </Label>
              <Input
                id="model-id"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={DEFAULT_MODEL}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
            />
            <p className="text-xs text-muted-foreground">
              默认 https://api.deepseek.com，如使用代理可替换。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
