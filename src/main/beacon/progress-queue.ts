import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** At most this many events in one `trackView` mutation. */
export const BATCH_SIZE = 10
/** How many events one account may keep while offline. The oldest go first. */
export const QUEUE_LIMIT = 500
/** Positions inside the same ten seconds count as one report, as in the app. */
const BUCKET_SECONDS = 10
/** How many mutations one flush may make, including one-at-a-time attribution. */
const FLUSH_MUTATIONS = 12
/** Refusals in one flush before leaving the rest for the next timer tick. */
const FLUSH_REFUSALS = 2
/** Failed sends before the queue gives up on a single event. */
export const MAX_TRIES = 24
/** First retry delay, doubled per failure up to the cap below. */
const RETRY_BASE_MS = 20_000
const RETRY_MAX_MS = 10 * 60_000

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
   * landed, take the title out of Continue watching. Used by an unwatched mark,
   * which is a newer decision than the row's old point.
   */
  removeFromContinueWatching?: boolean
  /**
   * Client bookkeeping, stripped before the GraphQL call: this event is a
   * hand-made mark rather than a playback position, so starting playback may
   * discard it.
   */
  explicitMark?: boolean
  /**
   * Client bookkeeping, stripped before the GraphQL call: this event is a
   * launch-time re-send of an explicit mark, so landing it spends one retry.
   */
  retryOfMark?: boolean
}

/** An update stamped for sending, as it sits in the queue. */
export interface QueuedEvent extends ProgressUpdate {
  /** ISO 8601, taken when the update happened, not when it is finally sent. */
  viewedAt: string
  sessionId: string
  /** Failed sends so far, persisted so a restart does not retry forever. */
  tries?: number
  /** epoch ms before which this event is not worth sending again. */
  retryAt?: number
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
  if (raw.explicitMark === true) event.explicitMark = true
  if (raw.retryOfMark === true) event.retryOfMark = true
  const tries = finite(raw.tries)
  if (tries != null && tries > 0) event.tries = Math.floor(tries)
  const retryAt = finite(raw.retryAt)
  if (retryAt != null) event.retryAt = retryAt
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
 * A refused batch is attributed one event at a time, retried with a backoff and
 * eventually dropped, and its title moves behind the rest of the queue: one
 * event the CMS will not take must not hold up every position behind it.
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
   * than a mark, so its 97%/1% point and row removal must not land afterwards.
   */
  dropMark(account: string, contentId: string): number {
    return this.dropWhere(
      account,
      (event) => event.content === contentId && event.explicitMark === true
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
    let mutations = 0
    let refusals = 0
    while (events.length && mutations < FLUSH_MUTATIONS && refusals < FLUSH_REFUSALS) {
      // An event the server has refused this often is not worth another twenty
      // seconds of retries; drop it and let whatever is behind it through.
      if (this.dropExhausted(events)) this.persist()
      if (!events.length) break

      const batch = this.dueBatch(events)
      if (!batch.length) break // everything left is waiting out a retry

      mutations += 1
      if (await this.trySend(send, batch)) {
        this.removeAll(events, batch)
        this.persist()
        continue
      }
      refusals += 1

      // A batch refused as a whole is attributed one event at a time, so one
      // bad event does not take the rest down with it. A single event is not
      // re-sent at once: that is the same request again, and it gets a backoff.
      if (batch.length === 1) {
        this.penalize(batch[0]!)
        if ((batch[0]!.tries ?? 0) >= MAX_TRIES) this.removeAll(events, [batch[0]!])
        this.persist()
        break
      }
      for (const event of batch) {
        if (mutations >= FLUSH_MUTATIONS || refusals >= FLUSH_REFUSALS) break
        mutations += 1
        if (await this.trySend(send, [event])) {
          this.removeAll(events, [event])
          this.persist()
          continue
        }
        refusals += 1
        this.penalize(event)
        if ((event.tries ?? 0) >= MAX_TRIES) this.removeAll(events, [event])
        else this.rotateTitle(events, event.content)
        this.persist()
        break
      }
    }
    return events.length === 0
  }

  /** Remove events the server has refused often enough to give up on. */
  private dropExhausted(events: QueuedEvent[]): boolean {
    let dropped = false
    for (let index = events.length - 1; index >= 0; index--) {
      if ((events[index]!.tries ?? 0) >= MAX_TRIES) {
        events.splice(index, 1)
        dropped = true
      }
    }
    return dropped
  }

  /**
   * The next batch worth sending. A title whose oldest report is waiting out a
   * retry holds back its own newer reports, so a retry can never overtake the
   * point it belongs with.
   */
  private dueBatch(events: QueuedEvent[]): QueuedEvent[] {
    const now = this.now().getTime()
    const waiting = new Set<string>()
    const batch: QueuedEvent[] = []
    for (const event of events) {
      if (batch.length >= BATCH_SIZE) break
      if (waiting.has(event.content)) continue
      if ((event.retryAt ?? 0) > now) {
        waiting.add(event.content)
        continue
      }
      batch.push(event)
    }
    return batch
  }

  private async trySend(send: SendEvents, batch: QueuedEvent[]): Promise<boolean> {
    try {
      return await send([...batch])
    } catch {
      // The caller keeps the events for the next attempt.
      return false
    }
  }

  /** Count a refusal and back off, so a rejected batch cannot hammer the CMS. */
  private penalize(event: QueuedEvent): void {
    const tries = (event.tries ?? 0) + 1
    event.tries = tries
    // The first refusal may be a blip, so the next flush may try again at once.
    const delay =
      tries <= 1 ? 0 : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(tries - 2, 10))
    event.retryAt = this.now().getTime() + delay
  }

  /**
   * Put a refused event, and everything else queued for its title, behind the
   * rest of the queue. Whole-title moves keep a newer report from overtaking an
   * older one for the same video.
   */
  private rotateTitle(events: QueuedEvent[], contentId: string): void {
    const moving = events.filter((event) => event.content === contentId)
    if (moving.length === events.length) return
    const rest = events.filter((event) => event.content !== contentId)
    events.splice(0, events.length, ...rest, ...moving)
  }

  private removeAll(events: QueuedEvent[], batch: QueuedEvent[]): void {
    // Remove exactly what was sent, not "the first N": a mark may have dropped
    // an event out of the queue while this batch was on the wire.
    const done = new Set(batch)
    for (let index = events.length - 1; index >= 0; index--) {
      if (done.has(events[index]!)) events.splice(index, 1)
    }
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
