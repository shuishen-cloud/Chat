/**
 * 服务端状态文件的原子读写。
 *
 * 只做一件事：把整包状态当成不透明 JSON 存进一个文件。
 * 之所以不用数据库：单人自用、数据几 MB、只整包读写，
 * 文件 + rename 已经够，且零原生依赖。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

export interface StoredState {
  /** 服务端写入时刻（毫秒）。仅用于并发检测，客户端不可伪造 */
  updatedAt: number
  /** ChatState 原样，服务端不解析字段 */
  state: unknown
}

export const EMPTY: StoredState = { updatedAt: 0, state: null }

/** 默认 `<repo>/data/state.json`，可用 STATE_FILE 覆盖（Docker 里指向挂载卷） */
export function stateFilePath(): string {
  return resolve(process.env.STATE_FILE || "data/state.json")
}

/**
 * 读状态。
 *
 * 文件不存在、内容损坏、结构不合法，一律按「服务端为空」处理：
 * 前端随后会用本地状态初始化。宁可重建也不要 500——
 * 一个坏文件不该让整个应用变成不可用。
 */
export async function readState(): Promise<StoredState> {
  const file = stateFilePath()
  let raw: string
  try {
    raw = await readFile(file, "utf8")
  } catch {
    return EMPTY
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>
    if (typeof parsed?.updatedAt !== "number" || !("state" in parsed)) {
      console.error(`[state] ${file} 结构不合法，按空处理`)
      return EMPTY
    }
    return { updatedAt: parsed.updatedAt, state: parsed.state }
  } catch (err) {
    console.error(`[state] ${file} 解析失败，按空处理`, err)
    return EMPTY
  }
}

/**
 * 写状态（原子）。
 *
 * 先写 `<file>.tmp` 再 rename：同文件系统内 rename 是原子的，
 * 进程在写入途中被杀也不会留下半截文件被下次读取到。
 */
export async function writeState(state: unknown): Promise<StoredState> {
  const file = stateFilePath()
  const next: StoredState = { updatedAt: Date.now(), state }

  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(next), "utf8")
  await rename(tmp, file)

  return next
}
