import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** At most this many events in one `trackView` mutation. */
export const BATCH_SIZE = 10
/** How many events one account may keep while offline. The oldest go first. */
export const QUEUE_LIMIT = 500
/** Positions inside the same ten seconds count as one report, as in the app. */
const BUCKET_SECONDS = 10

/** What the player hands the queue. */
export interface ProgressUpdate {
  content: string
  /** seconds */
  duration?: number
  /** 0..100 */
  videoProgress?: number
  /** seconds */
  videoProgressSeconds?: number
  /**
   * Client bookkeeping, stripped before the GraphQL call: once this event has
   * landed, take the title out of Continue watching. Used by an explicit mark,
   * which is a newer decision than the row's old point.
   */
  removeFromContinueWatching?: boolean
}

/** An update stamped for sending, as it sits in the queue. */
export interface QueuedEvent extends ProgressUpdate {
  /** ISO 8601, taken when the update happened, not when it is finally sent. */
  viewedAt: string
  sessionId: string
}

export type SendEvents = (events: QueuedEvent[]) => Promise<boolean>

/** account key → events still owed to Beacon */
type QueueFile = Record<string, QueuedEvent[]>

function defaultPath(): string | null {
  try {
    return progressQueuePath(app.getPath('userData'))
  } catch {
    // Not ready yet, or no Electron app (tests): keep the queue in memory.
    return null
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeEvent(value: unknown): QueuedEvent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<QueuedEvent>
  if (typeof raw.content !== 'string' || !raw.content) return null
  if (typeof raw.viewedAt !== 'string' || !raw.viewedAt) return null
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) return null
  const event: QueuedEvent = {
    content: raw.content,
    viewedAt: raw.viewedAt,
    sessionId: raw.sessionId
  }
  const duration = finite(raw.duration)
  const progress = finite(raw.videoProgress)
  const seconds = finite(raw.videoProgressSeconds)
  if (duration != null) event.duration = duration
  if (progress != null) event.videoProgress = progress
  if (seconds != null) event.videoProgressSeconds = seconds
  if (raw.removeFromContinueWatching === true) event.removeFromContinueWatching = true
  return event
}

function normalize(value: unknown): QueueFile {
  if (!value || typeof value !== 'object') return {}
  const out: QueueFile = {}
  for (const [account, events] of Object.entries(value as Record<string, unknown>)) {
    if (!account || !Array.isArray(events)) continue
    const kept: QueuedEvent[] = []
    for (const raw of events) {
      const event = normalizeEvent(raw)
      if (event) kept.push(event)
    }
    if (kept.length) out[account] = kept.slice(-QUEUE_LIMIT)
  }
  return out
}

/** The bucket a position belongs to when deciding two reports are the same. */
function bucket(seconds: number): number {
  return Math.floor(seconds / BUCKET_SECONDS) * BUCKET_SECONDS
}

/**
 * The app's progress tracker, for a desktop process: append to a bounded
 * per-account queue, send in batches of ten, and keep whatever a failed send
 * still owes Beacon. Events are written to disk on every append so closing the
 * app does not cost a position.
 *
 * One account's queue is never sent with another account's token, which is the
 * one place this deliberately differs from the app's single `unsentEvents` key.
 */
export class ProgressQueue {
  private state: QueueFile | null = null
  private readonly sending = new Map<string, Promise<boolean>>()

  constructor(
    private readonly path: () => string | null = defaultPath,
    private readonly isOnline: () => boolean = () => true,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Queue one update. Returns false when it was a duplicate and was dropped.
   * Like the app, the first report in a ten-second bucket is the one kept:
   * a later position in the same bucket would not move the point much anyway.
   */
  add(account: string, update: ProgressUpdate, sessionId: string): boolean {
    if (!account || !update.content) return false
    const events = this.eventsFor(account)
    const seconds = update.videoProgressSeconds
    if (seconds != null) {
      const same = events.some(
        (event) =>
          event.content === update.content &&
          event.videoProgressSeconds != null &&
          bucket(event.videoProgressSeconds) === bucket(seconds)
      )
      if (same) return false
    }
    events.push({ ...update, viewedAt: this.now().toISOString(), sessionId })
    if (events.length > QUEUE_LIMIT) events.splice(0, events.length - QUEUE_LIMIT)
    this.persist()
    return true
  }

  /** How many events this account still owes Beacon. */
  size(account: string): number {
    return this.eventsFor(account).length
  }

  /**
   * Forget every queued position for one title. A mark calls this before it
   * queues itself: a playback event from before the mark must not be replayed
   * after it, because Beacon keeps the last point it is told, not the furthest.
   */
  dropContent(account: string, contentId: string): number {
    return this.dropWhere(account, (event) => event.content === contentId)
  }

  /**
   * Forget an unsent mark for one title. Starting playback is a newer decision
   * than a mark, so its 99%/1% point and row removal must not land afterwards.
   */
  dropMark(account: string, contentId: string): number {
    return this.dropWhere(
      account,
      (event) => event.content === contentId && event.removeFromContinueWatching === true
    )
  }

  /** The queue as it stands; exposed for tests and diagnostics. */
  events(account: string): QueuedEvent[] {
    return [...this.eventsFor(account)]
  }

  /**
   * Send this account's queue in batches of ten, oldest first, until it is
   * empty or a batch fails. A failed or offline batch stays queued.
   */
  flush(account: string, send: SendEvents): Promise<boolean> {
    const running = this.sending.get(account)
    if (running) return running
    const events = this.eventsFor(account)
    if (!events.length) return Promise.resolve(true)
    if (!this.isOnline()) return Promise.resolve(false)
    const task = this.drain(events, send)
    this.sending.set(account, task)
    void task
      .finally(() => {
        if (this.sending.get(account) === task) this.sending.delete(account)
      })
      .catch(() => {})
    return task
  }

  private async drain(events: QueuedEvent[], send: SendEvents): Promise<boolean> {
    while (events.length) {
      const batch = events.slice(0, BATCH_SIZE)
      let sent = false
      try {
        sent = await send([...batch])
      } catch {
        // The caller keeps the events; the next flush tries again.
        sent = false
      }
      if (!sent) return false
      // Remove exactly what was sent, not "the first N": a mark may have
      // dropped an event out of the queue while this batch was on the wire.
      const done = new Set(batch)
      for (let index = events.length - 1; index >= 0; index--) {
        if (done.has(events[index]!)) events.splice(index, 1)
      }
      this.persist()
    }
    return true
  }

  private eventsFor(account: string): QueuedEvent[] {
    const state = this.load()
    if (!state[account]) state[account] = []
    return state[account]
  }

  private dropWhere(account: string, match: (event: QueuedEvent) => boolean): number {
    const events = this.eventsFor(account)
    const before = events.length
    for (let index = events.length - 1; index >= 0; index--) {
      if (match(events[index]!)) events.splice(index, 1)
    }
    const dropped = before - events.length
    if (dropped) this.persist()
    return dropped
  }

  private load(): QueueFile {
    if (this.state) return this.state
    const path = this.path()
    if (!path) return (this.state = {})
    try {
      this.state = normalize(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // No file yet, or one damaged beyond use. An empty queue is safe.
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
      // An unwritten queue still holds for this run; never crash playback.
    }
  }
}

/** Where the queue lives; it belongs beside the other per-account files. */
export function progressQueuePath(userData: string): string {
  return join(userData, 'progress-queue.json')
}
