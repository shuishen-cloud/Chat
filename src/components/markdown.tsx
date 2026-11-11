import { useRef, useState } from "react"

/**
 * Streamdown 太重，这里用 react-markdown 做轻量封装。
 * 流式过程中未闭合的代码块会补齐，避免闪烁。
 */
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose-chat text-sm leading-relaxed break-words",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            )
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs">{children}</table>
              </div>
            )
          },
          th({ children }) {
            return (
              <th className="border border-border bg-muted px-2 py-1 text-left font-medium">
                {children}
              </th>
            )
          },
          td({ children }) {
            return <td className="border border-border px-2 py-1 align-top">{children}</td>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  // 从 <pre><code class="language-xxx"> 中提取文本
  function extract(): string {
    return preRef.current?.innerText ?? ""
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(extract())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div className="group/code relative my-3">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-xs leading-relaxed"
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-foreground"
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  )
}

/** 流式输出时的光标 */
export function TypingCursor() {
  return (
    <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground align-middle" />
  )
}
