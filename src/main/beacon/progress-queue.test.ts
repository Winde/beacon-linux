import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BATCH_SIZE,
  MAX_TRIES,
  ProgressQueue,
  QUEUE_LIMIT,
  progressQueuePath,
  type QueuedEvent
} from './progress-queue'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const dirs: string[] = []

function newQueue(options: { online?: () => boolean; now?: () => Date } = {}): {
  queue: ProgressQueue
  path: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-progress-'))
  dirs.push(dir)
  const path = progressQueuePath(dir)
  const queue = new ProgressQueue(
    () => path,
    options.online ?? (() => true),
    options.now ?? (() => new Date('2026-11-17T12:00:00.000Z'))
  )
  return { queue, path }
}

function add(
  queue: ProgressQueue,
  content: string,
  seconds: number,
  account = 'member@example.com'
): boolean {
  return queue.add(
    account,
    {
      content,
      duration: 600,
      videoProgress: Math.min(100, Math.round((seconds / 600) * 100)),
      videoProgressSeconds: seconds
    },
    'linux-test'
  )
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ProgressQueue', () => {
  it('keeps the first report in each ten-second bucket per title', () => {
    const { queue } = newQueue()

    expect(add(queue, 'e1', 12)).toBe(true)
    expect(add(queue, 'e1', 18)).toBe(false)
    expect(add(queue, 'e1', 21)).toBe(true)
    expect(add(queue, 'e2', 18)).toBe(true)

    expect(queue.events('member@example.com').map((event) => event.videoProgressSeconds)).toEqual([
      12, 21, 18
    ])
  })

  it('sends ten at a time and drains the rest in order', async () => {
    const { queue } = newQueue()
    for (let step = 1; step <= 12; step++) add(queue, 'e1', step * 10)

    const batches: QueuedEvent[][] = []
    const ok = await queue.flush('member@example.com', async (events) => {
      batches.push(events)
      return true
    })

    expect(ok).toBe(true)
    expect(batches.map((batch) => batch.length)).toEqual([BATCH_SIZE, 2])
    expect(batches[1]![0]!.videoProgressSeconds).toBe(110)
    expect(queue.size('member@example.com')).toBe(0)
  })

  it('keeps a refused batch until a later flush can deliver it', async () => {
    let now = new Date('2026-11-17T12:00:00.000Z')
    const { queue } = newQueue({ now: () => now })
    add(queue, 'e1', 10)
    add(queue, 'e1', 20)

    const delivered: number[] = []
    let healthy = false
    const send = async (events: QueuedEvent[]): Promise<boolean> => {
      if (!healthy) return false
      delivered.push(...events.map((event) => event.videoProgressSeconds!))
      return true
    }

    await expect(queue.flush('member@example.com', send)).resolves.toBe(false)
    expect(queue.size('member@example.com')).toBe(2)

    now = new Date(now.getTime() + 60_000)
    healthy = true
    await expect(queue.flush('member@example.com', send)).resolves.toBe(true)

    // Both positions arrive, oldest first: a retry never overtakes the point
    // it belongs with.
    expect(delivered).toEqual([10, 20])
  })

  it('attributes a refused batch by sending its events one at a time', async () => {
    const { queue } = newQueue()
    add(queue, 'a', 10)
    add(queue, 'b', 10)

    const sizes: number[] = []
    await queue.flush('member@example.com', async (events) => {
      sizes.push(events.length)
      return sizes.length > 1 // the batch is refused, the single events are not
    })

    // One refused batch, then each event on its own; nothing is lost and the
    // second event is not blamed for the first.
    expect(sizes).toEqual([2, 1, 1])
    expect(queue.size('member@example.com')).toBe(0)
  })

  it('does not let a refused title hold up the queue', async () => {
    let now = new Date('2026-11-17T12:00:00.000Z')
    const { queue } = newQueue({ now: () => now })
    add(queue, 'poison', 10)
    add(queue, 'good', 10)

    const delivered: string[] = []
    const send = async (events: QueuedEvent[]): Promise<boolean> => {
      if (events.some((event) => event.content === 'poison')) return false
      delivered.push(...events.map((event) => event.content))
      return true
    }

    await expect(queue.flush('member@example.com', send)).resolves.toBe(false)
    expect(delivered).toEqual([])

    // The refused title now sits behind the rest and waits out its backoff.
    now = new Date(now.getTime() + 60_000)
    await expect(queue.flush('member@example.com', send)).resolves.toBe(false)

    expect(delivered).toEqual(['good'])
    expect(queue.events('member@example.com').map((event) => event.content)).toEqual(['poison'])
  })

  it('waits out the backoff before retrying a refused event', async () => {
    let now = new Date('2026-11-17T12:00:00.000Z')
    const { queue } = newQueue({ now: () => now })
    add(queue, 'e1', 10)

    const send = vi.fn(async () => false)

    await queue.flush('member@example.com', send)
    // The first refusal may be a blip, so one more attempt is allowed at once.
    await queue.flush('member@example.com', send)
    // The second starts the backoff: this flush must not touch the network.
    await queue.flush('member@example.com', send)
    expect(send).toHaveBeenCalledTimes(2)

    now = new Date(now.getTime() + 60_000)
    await queue.flush('member@example.com', send)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('holds a newer report back while its older one is retried', async () => {
    const now = new Date('2026-11-17T12:00:00.000Z')
    const { queue } = newQueue({ now: () => now })
    add(queue, 'e1', 10)
    add(queue, 'e1', 20)

    const send = vi.fn(async () => false)
    await queue.flush('member@example.com', send)
    await queue.flush('member@example.com', send)
    const attempts = send.mock.calls.length

    // The 10 s report is backing off, so the 20 s one waits for it rather than
    // overtaking it and moving the saved point backwards.
    await queue.flush('member@example.com', send)
    expect(send).toHaveBeenCalledTimes(attempts)
    expect(queue.size('member@example.com')).toBe(2)
  })

  it('keeps the retry countdown across a restart', async () => {
    let now = new Date('2026-11-17T12:00:00.000Z')
    const { queue, path } = newQueue({ now: () => now })
    add(queue, 'e1', 10)

    const send = vi.fn(async () => false)
    await queue.flush('member@example.com', send)
    await queue.flush('member@example.com', send) // now backing off

    const reopened = new ProgressQueue(
      () => path,
      () => true,
      () => now
    )
    const again = vi.fn(async () => false)
    await reopened.flush('member@example.com', again)
    expect(again).not.toHaveBeenCalled()

    now = new Date(now.getTime() + 60_000)
    await reopened.flush('member@example.com', again)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('gives up on an event the server keeps refusing', async () => {
    let now = new Date('2026-11-17T12:00:00.000Z')
    const { queue } = newQueue({ now: () => now })
    add(queue, 'e1', 10)
    add(queue, 'e1', 20)

    const delivered: number[] = []
    let refusals = 0
    const send = async (events: QueuedEvent[]): Promise<boolean> => {
      if (events.some((event) => event.videoProgressSeconds === 10)) {
        // Count only the single-event attribution attempts, one per flush.
        if (events.length === 1) refusals += 1
        return false
      }
      delivered.push(...events.map((event) => event.videoProgressSeconds!))
      return true
    }

    for (let attempt = 0; attempt <= MAX_TRIES; attempt++) {
      await queue.flush('member@example.com', send)
      now = new Date(now.getTime() + 60 * 60_000)
    }

    // Dropped exactly at the cap, and the newer report for the same title is
    // not lost with it.
    expect(refusals).toBe(MAX_TRIES)
    expect(delivered).toEqual([20])
    expect(queue.size('member@example.com')).toBe(0)
  })

  it('does not try to send while offline', async () => {
    const { queue } = newQueue({ online: () => false })
    add(queue, 'e1', 10)

    const send = vi.fn(async () => true)
    await expect(queue.flush('member@example.com', send)).resolves.toBe(false)

    expect(send).not.toHaveBeenCalled()
    expect(queue.size('member@example.com')).toBe(1)
  })

  it('drops the oldest events past the cap', () => {
    const { queue } = newQueue()
    for (let i = 0; i < QUEUE_LIMIT + 5; i++) add(queue, `e${i}`, 10)

    const events = queue.events('member@example.com')
    expect(events).toHaveLength(QUEUE_LIMIT)
    expect(events[0]!.content).toBe('e5')
  })

  it('drops queued positions for one title and keeps the rest', () => {
    const { queue } = newQueue()
    add(queue, 'e1', 10)
    add(queue, 'e1', 20)
    add(queue, 'e2', 10)

    expect(queue.dropContent('member@example.com', 'e1')).toBe(2)
    expect(queue.events('member@example.com').map((event) => event.content)).toEqual(['e2'])
  })

  it('drops an unsent mark without touching the title position', () => {
    const { queue } = newQueue()
    add(queue, 'e1', 10)
    queue.add(
      'member@example.com',
      {
        content: 'e1',
        videoProgress: 97,
        videoProgressSeconds: 599,
        explicitMark: true
      },
      'linux-test'
    )

    expect(queue.dropMark('member@example.com', 'e1')).toBe(1)
    expect(queue.events('member@example.com')).toEqual([
      expect.objectContaining({ content: 'e1', videoProgressSeconds: 10 })
    ])
  })

  it('removes a sent batch by identity when an event is dropped mid-flight', async () => {
    const { queue } = newQueue()
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
    for (const name of names) add(queue, name, 10)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const batches: string[][] = []
    const flushing = queue.flush('member@example.com', async (events) => {
      batches.push(events.map((event) => event.content))
      if (batches.length === 1) await gate
      return true
    })

    // A mark drops one event while the first ten are already on the wire.
    expect(queue.dropContent('member@example.com', 'a')).toBe(1)
    release()
    await expect(flushing).resolves.toBe(true)

    expect(batches).toEqual([names.slice(0, 10), ['k']])
    expect(queue.size('member@example.com')).toBe(0)
  })

  it('stamps an event when it happens, not when it is sent', () => {
    const { queue } = newQueue({ now: () => new Date('2026-11-17T09:30:00.000Z') })
    add(queue, 'e1', 10)

    expect(queue.events('member@example.com')[0]).toMatchObject({
      viewedAt: '2026-11-17T09:30:00.000Z',
      sessionId: 'linux-test'
    })
  })

  it('persists each account separately for the next launch', () => {
    const { queue, path } = newQueue()
    add(queue, 'e1', 10, 'one@example.com')
    add(queue, 'e2', 10, 'two@example.com')

    const reopened = new ProgressQueue(() => path)

    expect(reopened.events('one@example.com').map((event) => event.content)).toEqual(['e1'])
    expect(reopened.events('two@example.com').map((event) => event.content)).toEqual(['e2'])
  })

  it('keeps the mark retry flag across a restart', () => {
    const { queue, path } = newQueue()
    queue.add(
      'member@example.com',
      {
        content: 'e1',
        videoProgress: 97,
        videoProgressSeconds: 599,
        explicitMark: true,
        retryOfMark: true
      },
      'linux-test'
    )

    const reopened = new ProgressQueue(() => path)

    expect(reopened.events('member@example.com')[0]).toMatchObject({
      content: 'e1',
      explicitMark: true,
      retryOfMark: true
    })
  })

  it('does not send one account with another account queue', async () => {
    const { queue } = newQueue()
    add(queue, 'e1', 10, 'one@example.com')

    const send = vi.fn(async () => true)
    await expect(queue.flush('two@example.com', send)).resolves.toBe(true)

    expect(send).not.toHaveBeenCalled()
    expect(queue.size('one@example.com')).toBe(1)
  })

  it('starts empty when the file is damaged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beacon-progress-'))
    dirs.push(dir)
    const path = progressQueuePath(dir)
    writeFileSync(path, '{not json')

    const queue = new ProgressQueue(() => path)

    expect(queue.size('member@example.com')).toBe(0)
  })

  it('drops malformed entries instead of failing to load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beacon-progress-'))
    dirs.push(dir)
    const path = progressQueuePath(dir)
    writeFileSync(
      path,
      JSON.stringify({
        'member@example.com': [
          { content: 'good', viewedAt: '2026-11-17T12:00:00.000Z', sessionId: 's', duration: 10 },
          { content: 'missing stamps' },
          { viewedAt: '2026-11-17T12:00:00.000Z', sessionId: 's' },
          null
        ]
      })
    )

    const queue = new ProgressQueue(() => path)

    expect(queue.events('member@example.com').map((event) => event.content)).toEqual(['good'])
  })
})
