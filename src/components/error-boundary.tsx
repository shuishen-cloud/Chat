import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  children: ReactNode
  /** 出错时的兜底区域名，用于提示 */
  label?: string
  /** 变化时重置错误状态（比如关闭面板后再打开） */
  resetKey?: unknown
}

interface State {
  error: Error | null
}

/**
 * 局部错误边界：捕获子树渲染异常，避免整个应用白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <div className="text-sm font-medium">
          {this.props.label ? `${this.props.label} 出错了` : "此区域出错了"}
        </div>
        <pre className="max-h-32 w-full max-w-md overflow-auto rounded-md bg-muted p-2 text-left text-[11px] whitespace-pre-wrap text-muted-foreground">
          {this.state.error.message}
        </pre>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          重试
        </Button>
      </div>
    )
  }
}
