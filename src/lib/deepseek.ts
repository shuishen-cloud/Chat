import type { Message } from "./types"

export interface StreamOptions {
  apiKey: string
  baseUrl: string
  model: string
  messages: Message[]
  /**
   * 是否启用思考（思维链）。
   *
   * 保守实现：关闭时不向请求体附加任何非标参数，只是不再使用/展示 reasoning_content。
   * 原因见 doc/feat/board-colors-and-run.md —— DeepSeek 未公开思考开关参数，
   * 贸然发送未知字段可能导致整个请求被拒。
   */
  thinkingEnabled?: boolean
  signal?: AbortSignal
  onDelta: (delta: string) => void
  /** 思维链增量（deepseek-v4-pro 等推理模型） */
  onReasoning?: (delta: string) => void
}

export class DeepSeekError extends Error {}

function normalizeBase(baseUrl: string): string {
  const base = (baseUrl || "https://api.deepseek.com").trim().replace(/\/+$/, "")
  // 允许用户填 https://api.deepseek.com 或 https://api.deepseek.com/v1
  return base.endsWith("/v1") ? base : `${base}/v1`
}

export interface StreamResult {
  content: string
  reasoning: string
}

/**
 * 调用 DeepSeek 的 OpenAI 兼容接口，按 SSE 解析增量
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    thinkingEnabled = true,
    signal,
    onDelta,
    onReasoning,
  } = opts

  if (!apiKey.trim()) {
    throw new DeepSeekError("请先在「设置」中填写 DeepSeek API Key")
  }

  const res = await fetch(`${normalizeBase(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      messages: messages
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    let detail = ""
    try {
      const data = await res.json()
      detail = data?.error?.message ?? JSON.stringify(data)
    } catch {
      detail = await res.text().catch(() => "")
    }
    throw new DeepSeekError(
      `请求失败 (${res.status})${detail ? `：${detail}` : ""}`
    )
  }

  if (!res.body) throw new DeepSeekError("响应为空，当前浏览器不支持流式读取")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  let fullReasoning = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以空行分隔事件
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""

    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === "[DONE]") continue
        try {
          const json = JSON.parse(payload)
          const choice = json?.choices?.[0]
          const content: string = choice?.delta?.content ?? ""
          // 思考关闭时直接丢弃 reasoning_content，界面也就不会出现思维链
          const reasoning: string = thinkingEnabled
            ? (choice?.delta?.reasoning_content ?? "")
            : ""
          if (reasoning) {
            fullReasoning += reasoning
            onReasoning?.(reasoning)
          }
          if (content) {
            full += content
            onDelta(content)
          }
        } catch {
          // 忽略无法解析的分片
        }
      }
    }
  }

  return { content: full, reasoning: fullReasoning }
}
