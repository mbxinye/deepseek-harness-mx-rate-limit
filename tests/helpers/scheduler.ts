/**
 * A scheduler whose clock only moves when a test moves it, so admission order
 * and release timing are observable rather than raced against real timers.
 */
export class ManualScheduler {
  private current: number
  private readonly timers: { at: number; fn: () => void; cancelled: boolean }[] = []

  constructor(start = 0) {
    this.current = start
  }

  now = (): number => this.current

  schedule = (fn: () => void, ms: number): (() => void) => {
    const timer = { at: this.current + Math.max(0, ms), fn, cancelled: false }
    this.timers.push(timer)
    return () => { timer.cancelled = true }
  }

  /** Timers still waiting to fire. */
  get pendingTimers(): number {
    return this.timers.filter(timer => !timer.cancelled).length
  }

  /**
   * Move the clock forward, firing every timer that comes due along the way.
   *
   * Jumping straight to the end would skip intermediate grants, so the clock
   * steps to each due timer in order: that is what makes a release schedule
   * observable as a sequence of distinct moments.
   */
  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const due = this.timers
        .filter(timer => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0]
      if (due === undefined) break
      this.current = Math.max(this.current, due.at)
      due.cancelled = true
      this.timers.splice(this.timers.indexOf(due), 1)
      due.fn()
    }
    this.current = target
  }

  /** Let queued microtasks (promise resolutions) run without moving time. */
  async settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }
}