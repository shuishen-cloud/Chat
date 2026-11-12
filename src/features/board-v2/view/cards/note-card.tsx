/**
 * 便签卡片：自由文本（Markdown），也是连线执行的落点。
 *
 * 与消息卡片的差别只在「正文来源」与「无源消息可跳转」，
 * 其余（编辑态、历史、手柄、颜色）全部复用。
 */
import { useState } from "react"
import { FileText, History, Trash2 } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { HistoryList } from "@/components/board/history-list"
import { NodeHueButton } from "@/components/board/node-hue-button"
import { DEFAULT_WIDTH, type NodeRun, type NoteCard as NoteCardModel } from "../../model/doc"
import { CardHandles } from "../handles"
import { ResizeControls } from "../resize-controls"
import { CardHeader, CardIconButton, CardShell } from "./card-shell"
import { BodyEditor } from "./body-editor"

export type NoteCardActions = {
  onRemove: () => void
  /** 保存正文（写入 contentOverride，与执行输出同一字段） */
  onSaveContent: (text: string) => void
  onApplyRun: (runId: string) => void
  onSetHue: (hue: number | undefined) => void
}

export function NoteCard({
  card,
  dark,
  selected,
  sized,
  width,
  height,
  onResizeCommit,
  actions,
}: {
  card: NoteCardModel
  dark: boolean
  selected: boolean
  sized: boolean
  width: number
  height: number
  onResizeCommit: () => void
  actions: NoteCardActions
}) {
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const runs: NodeRun[] = card.runs ?? []
  /**
   * 正文：执行结果优先于手写内容。
   * 这样线跑完结果直接显示在便签里，而不是只躺在历史里。
   */
  const body = card.contentOverride ?? card.note ?? ""
  const produced = card.contentOverride !== undefined && card.contentOverride !== ""

  return (
    <CardShell
      tone="note"
      hue={card.hue}
      dark={dark}
      selected={selected}
      sized={sized}
      width={DEFAULT_WIDTH.note}
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
        title={card.title || "便签"}
        badgeTone="note"
        leading={<FileText className="size-3 shrink-0 opacity-60" />}
      >
        {produced && (
          <span className="shrink-0 rounded bg-current/10 px-1 text-[9px] opacity-70">已产出</span>
        )}
        <NodeHueButton hue={card.hue} onSet={actions.onSetHue} />
        {runs.length > 0 && (
          <CardIconButton title="历史" onClick={() => setShowHistory((v) => !v)} tone="note">
            <History className="size-3" />
          </CardIconButton>
        )}
        <CardIconButton title="删除便签" onClick={actions.onRemove} tone="note" danger>
          <Trash2 className="size-3" />
        </CardIconButton>
      </CardHeader>

      <BodyEditor
        editing={editing}
        initial={body}
        value={body}
        sized={sized}
        expanded
        mono
        placeholder="写点什么…（支持 Markdown）"
        onStartEdit={() => setEditing(true)}
        onCommit={(text) => {
          actions.onSaveContent(text)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
        renderReadonly={(text) => (text ? <Markdown content={text} /> : <span className="opacity-50">写点什么…</span>)}
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
