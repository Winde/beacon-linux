import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { accountKey } from './account'

/** The point Beacon reported when the member made the choice. */
export interface WatchMarkBase {
  /** 0..1 */
  progress: number
  /** seconds, or null when Beacon had no position for the title */
  position: number | null
}

/** An explicit watched/unwatched choice for one video. */
export interface WatchMark {
  watched: boolean
  /** epoch ms, used only to keep the newest write when two land together */
  at: number
  /**
   * What the server said when the mark was made. A mark is only safe to send
   * again while the point has not moved: if it has, someone watched the title
   * elsewhere and the older choice must not overwrite that.
   */
  base?: WatchMarkBase
  /** How many re-sends reached Beacon without it taking the mark. */
  sends?: number
}

/** account key → content id → mark */
type WatchFile = Record<string, Record<string, WatchMark>>

function defaultPath(): string | null {
  try {
    return watchMarksPath(app.getPath('userData'))
  } catch {
    // Not ready yet, or no Electron app (tests): keep the marks in memory.
    return null
  }
}

function normalize(value: unknown): WatchFile {
  if (!value || typeof value !== 'object') return {}
  const out: WatchFile = {}
  for (const [account, marks] of Object.entries(value as Record<string, unknown>)) {
    if (!marks || typeof marks !== 'object') continue
    const kept: Record<string, WatchMark> = {}
    for (const [content, mark] of Object.entries(marks as Record<string, unknown>)) {
      if (!content || !mark || typeof mark !== 'object') continue
      const { watched, at, base, sends } = mark as Partial<WatchMark>
      if (typeof watched !== 'boolean') continue
      const keptMark: WatchMark = {
        watched,
        at: typeof at === 'number' && Number.isFinite(at) ? at : 0
      }
      if (typeof sends === 'number' && Number.isFinite(sends) && sends > 0) {
        keptMark.sends = Math.floor(sends)
      }
      if (base && typeof base === 'object') {
        const { progress, position } = base as Partial<WatchMarkBase>
        if (typeof progress === 'number' && Number.isFinite(progress)) {
          keptMark.base = {
            progress: Math.min(1, Math.max(0, progress)),
            position: typeof position === 'number' && Number.isFinite(position) ? position : null
          }
        }
      }
      kept[content] = keptMark
    }
    if (Object.keys(kept).length) out[account] = kept
  }
  return out
}

/**
 * Marks the member made by hand. Beacon has no watched flag and ignores
 * progress writes at the extremes, so this is what keeps a badge correct until
 * the server's own read agrees with it. The file is a convenience, not a
 * credential: nothing in it is secret.
 */
export class WatchMarkStore {
  private state: WatchFile | null = null

  constructor(private readonly path: () => string | null = defaultPath) {}

  /** This account's marks. The record is live: do not mutate it from outside. */
  marks(email: string | null): Record<string, WatchMark> {
    return this.load()[accountKey(email)] ?? {}
  }

  set(email: string | null, contentId: string, watched: boolean, base?: WatchMarkBase): void {
    const state = this.load()
    const key = accountKey(email)
    const mark: WatchMark = { watched, at: Date.now() }
    if (base) mark.base = base
    state[key] = { ...(state[key] ?? {}), [contentId]: mark }
    this.persist()
  }

  /** Count one more launch-time retry. Returns the new count. */
  retried(email: string | null, contentId: string): number {
    const mark = this.load()[accountKey(email)]?.[contentId]
    if (!mark) return 0
    mark.sends = (mark.sends ?? 0) + 1
    this.persist()
    return mark.sends
  }

  clear(email: string | null, contentId: string): void {
    const state = this.load()
    const key = accountKey(email)
    const marks = state[key]
    if (!marks || !(contentId in marks)) return
    delete marks[contentId]
    if (!Object.keys(marks).length) delete state[key]
    this.persist()
  }

  private load(): WatchFile {
    if (this.state) return this.state
    const path = this.path()
    if (!path) return (this.state = {})
    try {
      this.state = normalize(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // No file yet, or one damaged beyond use. An empty set is safe.
      this.state = {}
    }
    return this.state
  }

  private persist(): void {
    const path = this.path()
    if (!path) return
    try {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      writeFileSync(temporary, JSON.stringify(this.state ?? {}), { mode: 0o600 })
      renameSync(temporary, path)
    } catch {
      // A local mark is not worth crashing over; it still holds for this run.
    }
  }
}

export function watchMarksPath(userData: string): string {
  return join(userData, 'watch-state.json')
}
