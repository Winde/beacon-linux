import { afterEach, describe, expect, it, vi } from 'vitest'
import { TtlCache } from './cache'

afterEach(() => {
  vi.useRealTimers()
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('TtlCache', () => {
  it('serves a fresh value without asking the loader again', async () => {
    const cache = new TtlCache<string, number>(60_000)
    const load = vi.fn(async () => 1)

    await expect(cache.load('a', load)).resolves.toBe(1)
    await expect(cache.load('a', load)).resolves.toBe(1)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('expires a value after its window', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache<string, number>(1_000)
    const load = vi.fn(async () => 1)

    await cache.load('a', load)
    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe(1)
    vi.advanceTimersByTime(1)

    expect(cache.get('a')).toBeUndefined()
    await cache.load('a', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('caches a null answer like any other', async () => {
    const cache = new TtlCache<string, number | null>(60_000)
    cache.set('a', null)

    expect(cache.get('a')).toBeNull()
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new TtlCache<string, number>(60_000)
    const load = vi.fn(async () => 1)

    await Promise.all([cache.load('a', load), cache.load('a', load), cache.load('a', load)])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries after a load fails', async () => {
    const cache = new TtlCache<string, number>(60_000)
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(2)

    await expect(cache.load('a', load)).rejects.toThrow('offline')
    await expect(cache.load('a', load)).resolves.toBe(2)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entry past its limit', () => {
    const cache = new TtlCache<string, number>(60_000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // 'a' is now the most recently used
    cache.set('c', 3)

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })

  it('forgets entries on clear and delete', () => {
    const cache = new TtlCache<string, number>(60_000)
    cache.set('a', 1)
    cache.set('b', 2)

    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()

    cache.clear()
    expect(cache.get('b')).toBeUndefined()
  })

  it('does not remember a load that was cleared while it ran', async () => {
    const cache = new TtlCache<string, number>(60_000)
    const first = deferred<number>()
    const load = vi.fn(() => first.promise)

    const pending = cache.load('a', load)
    cache.clear()
    first.resolve(1)

    await expect(pending).resolves.toBe(1)
    expect(cache.get('a')).toBeUndefined()
  })

  it('asks again after a clear even while the old load is running', async () => {
    const cache = new TtlCache<string, number>(60_000)
    const first = deferred<number>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(2)

    const stale = cache.load('a', load)
    cache.clear()
    await expect(cache.load('a', load)).resolves.toBe(2)

    first.resolve(1)
    await expect(stale).resolves.toBe(1)
    expect(cache.get('a')).toBe(2)
  })
})
