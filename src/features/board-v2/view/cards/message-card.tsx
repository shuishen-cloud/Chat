/**
 * 消息卡片：引用一条对话消息，可摘录、改写、展开。
 *
 * 只做渲染与本地编辑态；所有跨组件的动作都通过 `actions` 回调走，
 * 由视图层统一接到 store。这样卡片本身不依赖任何 store 细节。
 */
import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, History, Pencil, RotateCcw, Trash2 } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { HistoryList } from "@/components/board/history-list"
import { NodeHueButton } from "@/components/board/node-hue-button"
import { DEFAULT_WIDTH, type MessageCard as MessageCardModel, type NodeRun } from "../../model/doc"
import { CardHandles } from "../handles"
import { ResizeControls } from "../resize-controls"
import { CardHeader, CardIconButton, CardShell } from "./card-shell"
import { BodyEditor } from "./body-editor"

export type MessageCardActions = {
  onRemove: () => void
  onToggleExpand: () => void
  onJump?: () => void
  onSaveContent: (text: string) => void
  onRestore: () => void
  onApplyRun: (runId: string) => void
  onSetHue: (hue: number | undefined) => void
  /** 渲染过程中手柄被按下（用于状态机与高亮） */
  onHandleDown?: (handle: string) => void
}

export function MessageCard({
  card,
  source,
  dark,
  selected,
  sized,
  width,
  height,
  onResizeCommit,
  actions,
}: {
  card: MessageCardModel
  source?: { text: string; title: string; role: "user" | "assistant" }
  dark: boolean
  selected: boolean
  sized: boolean
  /** 当前节点尺寸（缩放控件的起点） */
  width: number
  height: number
  /** 缩放松手：交给画布落库 */
  onResizeCommit: () => void
  actions: MessageCardActions
}) {
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const isUser = source?.role === "user"
  const overridden = card.contentOverride !== undefined && card.contentOverride !== ""
  const body = overridden ? card.contentOverride! : (card.excerpt || source?.text || "")
  const runs: NodeRun[] = card.runs ?? []
  const title = card.title || source?.title || "来源对话"

  return (
    <CardShell
      tone="message"
      hue={card.hue}
      dark={dark}
      selected={selected}
      sized={sized}
      width={DEFAULT_WIDTH.message}
      overlay={
        <>
          <CardHandles />
          <ResizeControls
            nodeId={card.id}
            width={width}
            height={height}
            visible={selected}
            onCommit={onResizeCommit}
          />
        </>
      }
    >
      <CardHeader
        badge={isUser ? "我" : "DS"}
        badgeTone={isUser ? "user" : "assistant"}
        title={title}
      >
        <NodeHueButton hue={card.hue} onSet={actions.onSetHue} />
        {overridden && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-600 dark:text-amber-400">
            已改写
          </span>
        )}
        {runs.length > 0 && (
          <CardIconButton title="历史" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-3" />
          </CardIconButton>
        )}
        <CardIconButton title="编辑内容" onClick={() => setEditing(true)}>
          <Pencil className="size-3" />
        </CardIconButton>
        {overridden && (
          <CardIconButton title="还原为原文" onClick={actions.onRestore}>
            <RotateCcw className="size-3" />
          </CardIconButton>
        )}
        {actions.onJump && (
          <CardIconButton title="回到原消息" onClick={actions.onJump}>
            <ExternalLink className="size-3" />
          </CardIconButton>
        )}
        <CardIconButton
          title={card.expanded ? "收起" : "展开全文"}
          onClick={actions.onToggleExpand}
        >
          {card.expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </CardIconButton>
        <CardIconButton title="从画板移除" onClick={actions.onRemove} danger>
          <Trash2 className="size-3" />
        </CardIconButton>
      </CardHeader>

      <BodyEditor
        editing={editing}
        initial={card.contentOverride ?? body}
        value={body}
        sized={sized}
        expanded={!!card.expanded}
        placeholder="（空）"
        onStartEdit={() => setEditing(true)}
        onCommit={(text) => {
          actions.onSaveContent(text)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
        renderReadonly={(text) => <Markdown content={text} />}
      />

      {showHistory && runs.length > 0 && (
        <HistoryList
          runs={runs}
          onApply={(runId) => actions.onApplyRun(runId)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </CardShell>
  )
}
