/**
 * 长按判定（纯函数部分）。
 *
 * 抽出来单独测的理由：长按的 90% 是「什么时候不该触发」——
 * 中途位移、提前抬手、组件卸载。把这些判定写成纯函数后，
 * 用假时钟就能覆盖，不必开浏览器。
 */

/** 长按阈值：压住多久算长按 */
export const LONG_PRESS_MS = 500
/** 位移容差：超过即视为拖动/误触，取消长按 */
export const LONG_PRESS_MOVE_TOLERANCE = 6

export type LongPressOptions = {
  /** 毫秒阈值，默认 LONG_PRESS_MS */
  delay?: number
  /** 像素容差，默认 LONG_PRESS_MOVE_TOLERANCE */
  tolerance?: number
  /** 达到阈值时回调，参数是按下时的指针位置 */
  onLongPress?: (origin: { x: number; y: number }) => void
  /** 未达阈值就抬起时回调（即普通点击） */
  onPress?: (point: { x: number; y: number }) => void
  /** 达到阈值前的取消（位移超限、pointercancel） */
  onCancel?: () => void
}

export type LongPressScheduler = {
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
}

/** 默认调度器：浏览器 setTimeout；测试可换成假时钟 */
export const realScheduler: LongPressScheduler = {
  setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimer: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
}

/**
 * 长按状态机。
 *
 * 状态只有三种：idle → pending → fired。任何取消路径都回到 idle，
 * 因此「抬手后定时器还在跑」这类经典 bug 在结构上不会出现。
 */
export class LongPressTracker {
  private timer: number | null = null
  private origin: { x: number; y: number } | null = null
  private fired = false
  private readonly opts: LongPressOptions
  private readonly scheduler: LongPressScheduler

  // 显式赋值而非参数属性：node --test 的 strip-only 模式不支持参数属性
  constructor(opts: LongPressOptions, scheduler: LongPressScheduler = realScheduler) {
    this.opts = opts
    this.scheduler = scheduler
  }

  private get delay() {
    return this.opts.delay ?? LONG_PRESS_MS
  }

  private get tolerance() {
    return this.opts.tolerance ?? LONG_PRESS_MOVE_TOLERANCE
  }

  /** 是否已触发过长按（用于抬手时区分点击） */
  get isFired() {
    return this.fired
  }

  /** 是否在等待阈值中 */
  get isPending() {
    return this.timer !== null
  }

  down(point: { x: number; y: number }) {
    this.cancel()
    this.fired = false
    this.origin = { x: point.x, y: point.y }
    this.timer = this.scheduler.setTimer(() => {
      this.timer = null
      this.fired = true
      this.opts.onLongPress?.(this.origin ?? point)
    }, this.delay)
  }

  move(point: { x: number; y: number }) {
    if (this.timer === null || !this.origin) return
    const dx = point.x - this.origin.x
    const dy = point.y - this.origin.y
    if (Math.hypot(dx, dy) > this.tolerance) {
      this.cancel()
      this.opts.onCancel?.()
    }
  }

  /** 抬手：未触达阈值时按普通点击处理 */
  up(point: { x: number; y: number }) {
    const wasPending = this.timer !== null
    this.cancel()
    if (wasPending) this.opts.onPress?.(this.origin ?? point)
    this.fired = false
    this.origin = null
  }

  /** 显式取消（pointercancel / 卸载 / 位移超限） */
  cancel() {
    if (this.timer !== null) {
      this.scheduler.clearTimer(this.timer)
      this.timer = null
    }
  }

  dispose() {
    this.cancel()
    this.origin = null
    this.fired = false
  }
}
