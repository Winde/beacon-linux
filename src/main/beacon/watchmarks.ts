import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** An explicit watched/unwatched choice for one video. */
export interface WatchMark {
  watched: boolean
  /** epoch ms, used only to keep the newest write when two land together */
  at: number
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

/** Keyed like the other per-account files: the sign-in address, lowercased. */
export function accountKey(email: string | null | undefined): string {
  const address = (email ?? '').trim().toLowerCase()
  return address || 'guest'
}

function normalize(value: unknown): WatchFile {
  if (!value || typeof value !== 'object') return {}
  const out: WatchFile = {}
  for (const [account, marks] of Object.entries(value as Record<string, unknown>)) {
    if (!marks || typeof marks !== 'object') continue
    const kept: Record<string, WatchMark> = {}
    for (const [content, mark] of Object.entries(marks as Record<string, unknown>)) {
      if (!content || !mark || typeof mark !== 'object') continue
      const { watched, at } = mark as Partial<WatchMark>
      if (typeof watched !== 'boolean') continue
      kept[content] = {
        watched,
        at: typeof at === 'number' && Number.isFinite(at) ? at : 0
      }
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

  set(email: string | null, contentId: string, watched: boolean): void {
    const state = this.load()
    const key = accountKey(email)
    state[key] = { ...(state[key] ?? {}), [contentId]: { watched, at: Date.now() } }
    this.persist()
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
