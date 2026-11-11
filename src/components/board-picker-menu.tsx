import { Check, LayoutGrid, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Board } from "@/lib/types"

/**
 * 画板选择下拉菜单。
 *
 * 「把内容放进哪个画板」在三个入口都会出现（多选栏、划词浮层、消息动作条），
 * 菜单结构完全一样，只是触发按钮的文案和选中后的行为不同。
 * 抽成一个组件，避免新增入口时又抄一份菜单导致行为漂移。
 */
export function BoardPickerMenu({
  boards,
  /** 当前选中的画板；不传则不显示勾选态（用于"点完即走"的一次性选择） */
  selectedId,
  /** 选中已有画板 */
  onPick,
  /** 新建画板并加入；传 null 表示走「新建」分支 */
  onCreate,
  /** 触发按钮文案 */
  label = "画板",
  /** 菜单顶部标题 */
  title = "加入指定画板",
  align = "start",
  /** 触发按钮变体：多选栏要更显眼，划词浮层用 ghost */
  variant = "ghost",
  triggerClassName,
}: {
  boards: Board[]
  selectedId?: string | null
  onPick: (boardId: string) => void
  onCreate: () => void
  label?: string
  title?: string
  align?: "start" | "end" | "center"
  variant?: "ghost" | "outline" | "secondary"
  triggerClassName?: string
}) {
  const showCheck = selectedId !== undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant={variant}
            className={cn("h-6 gap-1 px-2 text-[11px]", triggerClassName)}
          >
            <LayoutGrid className="size-3" />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {boards.map((b) => (
            <DropdownMenuItem
              key={b.id}
              className={cn("gap-2", showCheck && b.id === selectedId && "bg-accent")}
              onClick={() => onPick(b.id)}
            >
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {showCheck && b.id === selectedId && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuItem className="gap-2" onClick={onCreate}>
          <Plus className="size-4" />
          新建画板并加入
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
