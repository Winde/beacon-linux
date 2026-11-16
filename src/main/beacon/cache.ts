/**
 * A small in-memory TTL cache with single-flight loads.
 *
 * Beacon answers the same questions constantly while a member browses, and most
 * answers stay right for minutes. Caches hold account-specific data, so their
 * owners clear them when the account changes.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { at: number; value: V }>()
  private readonly inflight = new Map<K, Promise<V>>()
  /** Bumped by clear(), so a load that started before it cannot write back. */
  private generation = 0

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100
  ) {}

  /** The value while it is still fresh, or undefined. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    // Map iteration order is insertion order, so re-inserting makes this the
    // most recently used entry and keeps the eviction below honest.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { at: Date.now(), value })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  delete(key: K): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    // A load already running asked the CMS before whatever prompted the clear,
    // so its answer is stale: a caller arriving now must start a fresh one.
    this.inflight.clear()
    this.generation += 1
  }

  /**
   * A fresh value, an already-running load, or a new one. Concurrent callers
   * for the same key share a single request instead of racing.
   */
  async load(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const running = this.inflight.get(key)
    if (running) return running

    const generation = this.generation
    const pending = loader()
      .then((value) => {
        // Cleared while this was in flight: the answer predates the change the
        // caller wanted to see. Hand it back, but do not remember it.
        if (generation === this.generation) this.set(key, value)
        return value
      })
      .finally(() => {
        // Only retire our own entry: a clear() may have put a new load there.
        if (this.inflight.get(key) === pending) this.inflight.delete(key)
      })
    this.inflight.set(key, pending)
    return pending
  }
}
