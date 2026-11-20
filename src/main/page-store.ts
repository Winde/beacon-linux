import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CachedPages, CollectionData, ContentData } from '@shared/types'

/**
 * Bump when CollectionData or ContentData changes shape. An older file is
 * dropped, not read: a page painted from the wrong shape is worse than a load.
 */
const PAGE_STORE_VERSION = 2

/**
 * The file size is the real bound; the per-kind count only stops a pathological
 * number of tiny entries (an empty collection is under 500 bytes).
 *
 * Measured against the live catalog on 2026-11-17:
 * - CollectionData: p50 4.3 KiB, p95 10.4 KiB, max 68.4 KiB (123 episodes)
 * - ContentData: p50 7.5 KiB, p95 9.4 KiB, max 9.9 KiB
 *
 * A 2 MiB budget is about 2.2x the 932 KiB catalog index and holds roughly 230
 * episode pages or 120 collection pages at the median, while still leaving room
 * for a 68 KiB series. A typical 20 collection + 20 episode working set is
 * ~330 KiB, so this is about six times that.
 */
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_PAGES_PER_KIND = 60

interface StoredPage<T> {
  /** When this copy was last confirmed with the CMS. */
  savedAt: number
  /** When the viewer last opened it; drives eviction. */
  usedAt: number
  data: T
}

interface StoredPages {
  version: number
  /** The account the pages belong to; guests use `guest`. */
  scope: string
  savedAt: number
  collections: Record<string, StoredPage<CollectionData>>
  contents: Record<string, StoredPage<ContentData>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCard(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    (value['kind'] === 'video' || value['kind'] === 'series') &&
    typeof value['slug'] === 'string' &&
    typeof value['title'] === 'string'
  )
}

function isRow(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value['title'] === 'string' &&
    Array.isArray(value['items']) &&
    value['items'].every(isCard)
  )
}

function isImage(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function isCollectionData(value: unknown): value is CollectionData {
  if (!isRecord(value)) return false
  const seasons = value['seasons']
  return (
    typeof value['id'] === 'string' &&
    typeof value['slug'] === 'string' &&
    typeof value['title'] === 'string' &&
    isImage(value['image']) &&
    isImage(value['image2x']) &&
    typeof value['isSeries'] === 'boolean' &&
    Array.isArray(seasons) &&
    seasons.every(
      (season) =>
        isRecord(season) &&
        typeof season['title'] === 'string' &&
        Array.isArray(season['items']) &&
        season['items'].every(isCard)
    )
  )
}

function isContentData(value: unknown): value is ContentData {
  if (!isRecord(value)) return false
  const series = value['series']
  const rows = value['rows']
  const seriesOk =
    series === null ||
    (isRecord(series) &&
      typeof series['slug'] === 'string' &&
      typeof series['title'] === 'string' &&
      typeof series['isSeries'] === 'boolean')
  return (
    typeof value['id'] === 'string' &&
    typeof value['slug'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['description'] === 'string' &&
    typeof value['continuedSummary'] === 'string' &&
    isImage(value['image']) &&
    isImage(value['image2x']) &&
    (value['minutes'] === null || typeof value['minutes'] === 'number') &&
    (value['released'] === null || typeof value['released'] === 'string') &&
    (value['kind'] === 'video' || value['kind'] === 'audio') &&
    seriesOk &&
    (value['tier'] === null || typeof value['tier'] === 'string') &&
    typeof value['locked'] === 'boolean' &&
    typeof value['signInNeeded'] === 'boolean' &&
    typeof value['signedIn'] === 'boolean' &&
    typeof value['watched'] === 'boolean' &&
    typeof value['resumeAt'] === 'number' &&
    Array.isArray(rows) &&
    rows.every(isRow)
  )
}

/**
 * The last collection and episode pages on disk, so a launch can paint a page
 * it has seen before while the request confirms it.
 *
 * Like Home, every page is account-specific (progress badges, locked flags,
 * resume points), so the file is keyed by account and schema version. A file
 * belonging to another account is deleted on sight, not merely ignored.
 *
 * The store is bounded per kind and evicts the least recently used page. A
 * page that stays fresh in the request cache is still written back when the
 * viewer opens it, which is what keeps a favourite series from ageing out.
 */
export class PageStore {
  /** The parsed file, kept between the boot read and later writes. */
  private loaded: StoredPages | null = null
  private loadedScope: string | null = null

  constructor(private readonly directory: () => string) {}

  private path(): string {
    return join(this.directory(), 'page-cache.json')
  }

  /**
   * Every page for this scope. Reading the whole slot is what lets the
   * renderer answer any page from the last launch before the first request.
   */
  readAll(scope: string): CachedPages {
    const stored = this.ensure(scope)
    return {
      collections: Object.values(stored.collections).map((entry) => entry.data),
      contents: Object.values(stored.contents).map((entry) => entry.data)
    }
  }

  /** Keep a page after a successful read, and make it the most recently used. */
  saveCollection(scope: string, data: CollectionData): void {
    const stored = this.ensure(scope)
    const now = Date.now()
    stored.collections[data.slug] = { savedAt: now, usedAt: now, data }
    this.write(scope, stored)
  }

  /** Keep an episode page after a successful read. */
  saveContent(scope: string, data: ContentData): void {
    const stored = this.ensure(scope)
    const now = Date.now()
    stored.contents[data.slug] = { savedAt: now, usedAt: now, data }
    this.write(scope, stored)
  }

  /** The CMS says this series/collection no longer exists; stop painting it. */
  deleteCollection(scope: string, slug: string): void {
    const stored = this.ensure(scope)
    if (!stored.collections[slug]) return
    delete stored.collections[slug]
    this.write(scope, stored)
  }

  /** The CMS says this episode no longer exists. */
  deleteContent(scope: string, slug: string): void {
    const stored = this.ensure(scope)
    if (!stored.contents[slug]) return
    delete stored.contents[slug]
    this.write(scope, stored)
  }

  /** Remove the slot. Safe to call when there is nothing to remove. */
  clear(): void {
    this.loaded = null
    this.loadedScope = null
    try {
      rmSync(this.path(), { force: true })
      rmSync(`${this.path()}.tmp`, { force: true })
    } catch {
      // A read-only or unavailable home directory is not worth failing over.
    }
  }

  private empty(scope: string): StoredPages {
    return {
      version: PAGE_STORE_VERSION,
      scope,
      savedAt: Date.now(),
      collections: {},
      contents: {}
    }
  }

  /** The file for this scope, or an empty in-memory slot. Never writes. */
  private ensure(scope: string): StoredPages {
    if (this.loaded && this.loadedScope === scope) return this.loaded
    const fromDisk = this.readFile(scope)
    if (fromDisk) return fromDisk
    const empty = this.empty(scope)
    this.loaded = empty
    this.loadedScope = scope
    return empty
  }

  private readFile(scope: string): StoredPages | null {
    let raw: string
    try {
      raw = readFileSync(this.path(), 'utf8')
    } catch {
      // No file yet: the normal first launch.
      return null
    }
    // A file this large was not written by this version, or was edited. Drop it
    // before parsing rather than turning it into a multi-megabyte page cache.
    if (Buffer.byteLength(raw) > MAX_PAGE_BYTES) {
      this.clear()
      return null
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed['scope'] !== scope || parsed['version'] !== PAGE_STORE_VERSION) {
        this.clear()
        return null
      }

      const collections = this.readMap<CollectionData>(parsed['collections'], isCollectionData)
      const contents = this.readMap<ContentData>(parsed['contents'], isContentData)
      if (!collections || !contents) {
        this.clear()
        return null
      }

      const stored: StoredPages = {
        version: PAGE_STORE_VERSION,
        scope,
        savedAt: typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : Date.now(),
        collections,
        contents
      }
      this.loaded = stored
      this.loadedScope = scope
      return stored
    } catch {
      this.clear()
      return null
    }
  }

  private readMap<T>(
    value: unknown,
    valid: (page: unknown) => page is T
  ): Record<string, StoredPage<T>> | null {
    if (value === undefined) return {}
    if (!isRecord(value)) return null
    const target: Record<string, StoredPage<T>> = {}
    for (const [slug, entry] of Object.entries(value)) {
      if (!isRecord(entry)) return null
      const data = entry['data']
      if (!valid(data)) return null
      const savedAt = entry['savedAt']
      const usedAt = entry['usedAt']
      if (typeof savedAt !== 'number' || typeof usedAt !== 'number') return null
      target[slug] = { savedAt, usedAt, data }
    }
    return target
  }

  /** Keep a kind from growing into thousands of tiny entries. */
  private trimCount<T>(entries: Record<string, StoredPage<T>>): void {
    const keys = Object.keys(entries)
    if (keys.length <= MAX_PAGES_PER_KIND) return
    keys.sort((a, b) => entries[a]!.usedAt - entries[b]!.usedAt)
    for (const key of keys.slice(0, keys.length - MAX_PAGES_PER_KIND)) delete entries[key]
  }

  /**
   * Evict the least recently used page, whichever kind it belongs to, until the
   * file fits the budget. One huge series then cannot crowd out a set of small
   * episode pages that were opened more recently.
   */
  private evictOldest(stored: StoredPages): boolean {
    let oldest: { kind: 'collection' | 'content'; slug: string; usedAt: number } | null = null
    for (const [slug, entry] of Object.entries(stored.collections)) {
      if (!oldest || entry.usedAt < oldest.usedAt) {
        oldest = { kind: 'collection', slug, usedAt: entry.usedAt }
      }
    }
    for (const [slug, entry] of Object.entries(stored.contents)) {
      if (!oldest || entry.usedAt < oldest.usedAt) {
        oldest = { kind: 'content', slug, usedAt: entry.usedAt }
      }
    }
    if (!oldest) return false
    if (oldest.kind === 'collection') delete stored.collections[oldest.slug]
    else delete stored.contents[oldest.slug]
    return true
  }

  private encode(stored: StoredPages): string {
    this.trimCount(stored.collections)
    this.trimCount(stored.contents)
    let json = JSON.stringify(stored)
    while (Buffer.byteLength(json) > MAX_PAGE_BYTES && this.evictOldest(stored)) {
      json = JSON.stringify(stored)
    }
    return json
  }

  private write(scope: string, stored: StoredPages): void {
    try {
      const target = this.path()
      mkdirSync(dirname(target), { recursive: true })
      stored.scope = scope
      stored.savedAt = Date.now()
      // Write beside the target and swap it in, so a crash cannot leave half a
      // file that parses into a wrong page.
      const temporary = `${target}.tmp`
      writeFileSync(temporary, this.encode(stored), { mode: 0o600 })
      renameSync(temporary, target)
      this.loaded = stored
      this.loadedScope = scope
    } catch {
      // The cache is a speed-up; losing it only costs the next launch's head start.
    }
  }
}
