import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FavouritesData, HomeData } from '@shared/types'

/**
 * Bump when HomeData or FavouritesData changes shape; an older file is dropped,
 * not read. Version 1 held only the feed and is migrated on read.
 */
const HOME_STORE_VERSION = 2

interface StoredHome {
  version: number
  /** The account the screen belongs to; guests use `guest`. */
  scope: string
  savedAt: number
  home?: HomeData
  favourites?: FavouritesData
}

/** What a launch can paint before the network answers. */
export interface CachedHome {
  home: HomeData | null
  favourites: FavouritesData | null
}

function isCard(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const card = value as { kind?: unknown; slug?: unknown; title?: unknown }
  return (
    (card.kind === 'video' || card.kind === 'series') &&
    typeof card.slug === 'string' &&
    typeof card.title === 'string'
  )
}

function isHomeData(value: unknown): value is HomeData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<HomeData>
  if (!Array.isArray(data.hero) || !Array.isArray(data.rows)) return false
  if (!data.hero.every(isCard)) return false
  return data.rows.every((row) => {
    if (!row || typeof row !== 'object') return false
    const shelf = row as { id?: unknown; title?: unknown; items?: unknown }
    return (
      typeof shelf.id === 'string' &&
      typeof shelf.title === 'string' &&
      Array.isArray(shelf.items) &&
      shelf.items.every(isCard)
    )
  })
}

function isFavouriteItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as {
    kind?: unknown
    id?: unknown
    slug?: unknown
    title?: unknown
    image?: unknown
    image2x?: unknown
    count?: unknown
  }
  return (
    item.kind === 'series' &&
    typeof item.id === 'string' &&
    typeof item.slug === 'string' &&
    typeof item.title === 'string' &&
    (item.image === null || typeof item.image === 'string') &&
    (item.image2x === null || typeof item.image2x === 'string') &&
    (item.count === null || typeof item.count === 'number')
  )
}

function isFavouritesData(value: unknown): value is FavouritesData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<FavouritesData>
  return (
    Array.isArray(data.items) &&
    data.items.every(isFavouriteItem) &&
    (data.after === null || typeof data.after === 'string')
  )
}

/**
 * The last Home screen on disk: the feed and the Favourites row, in one slot,
 * so the next launch can paint both before any request returns.
 *
 * Both are account-specific (progress, tier, locked flags, favourites), so the
 * file is keyed by account and schema version. Every read is checked against
 * the current scope; a mismatch is deleted, not merely ignored. Clearing is
 * best effort and never throws.
 */
export class HomeStore {
  /** The parsed file, kept between the two boot reads and later writes. */
  private loaded: StoredHome | null = null
  private loadedScope: string | null = null

  constructor(private readonly directory: () => string) {}

  private path(): string {
    return join(this.directory(), 'home-cache.json')
  }

  /**
   * The feed and row for this scope, or null when there is nothing usable.
   * Anything belonging to someone else, an older schema, or a damaged file is
   * removed so it cannot be tried again on every launch.
   */
  read(scope: string): CachedHome | null {
    const stored = this.ensure(scope)
    if (!stored.home && !stored.favourites) return null
    return { home: stored.home ?? null, favourites: stored.favourites ?? null }
  }

  /** Replace the feed after a successful fetch. A failed one never gets here. */
  saveHome(scope: string, home: HomeData): void {
    // An empty page is what a CMS hiccup looks like; keeping the previous
    // launch's rows is more useful than caching nothing.
    if (!home.hero.length && !home.rows.length) return
    const stored = this.ensure(scope)
    stored.home = home
    this.write(scope, stored)
  }

  /** Replace the Favourites row after a read or a change to it. */
  saveFavourites(scope: string, favourites: FavouritesData): void {
    const stored = this.ensure(scope)
    stored.favourites = favourites
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

  /** The file for this scope, or an empty in-memory slot. Never writes. */
  private ensure(scope: string): StoredHome {
    if (this.loaded && this.loadedScope === scope) return this.loaded
    const fromDisk = this.readFile(scope)
    if (fromDisk) return fromDisk
    const empty: StoredHome = {
      version: HOME_STORE_VERSION,
      scope,
      savedAt: Date.now()
    }
    this.loaded = empty
    this.loadedScope = scope
    return empty
  }

  private readFile(scope: string): StoredHome | null {
    let raw: string
    try {
      raw = readFileSync(this.path(), 'utf8')
    } catch {
      // No file yet: the normal first launch.
      return null
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed['scope'] !== scope) {
        this.clear()
        return null
      }
      // Version 1 held only the feed. Keep it; the next write stores version 2
      // with the Favourites row added.
      if (parsed['version'] === 1) {
        if (!isHomeData(parsed['data'])) {
          this.clear()
          return null
        }
        const migrated: StoredHome = {
          version: HOME_STORE_VERSION,
          scope,
          savedAt: typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : Date.now(),
          home: parsed['data']
        }
        this.loaded = migrated
        this.loadedScope = scope
        return migrated
      }
      if (parsed['version'] !== HOME_STORE_VERSION) {
        this.clear()
        return null
      }
      const home = parsed['home']
      const favourites = parsed['favourites']
      if (home !== undefined && !isHomeData(home)) {
        this.clear()
        return null
      }
      if (favourites !== undefined && !isFavouritesData(favourites)) {
        this.clear()
        return null
      }
      const stored: StoredHome = {
        version: HOME_STORE_VERSION,
        scope,
        savedAt: typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : Date.now(),
        ...(home !== undefined ? { home } : {}),
        ...(favourites !== undefined ? { favourites } : {})
      }
      this.loaded = stored
      this.loadedScope = scope
      return stored
    } catch {
      this.clear()
      return null
    }
  }

  private write(scope: string, stored: StoredHome): void {
    try {
      const target = this.path()
      mkdirSync(dirname(target), { recursive: true })
      stored.scope = scope
      stored.savedAt = Date.now()
      // Write beside the target and swap it in, so a crash cannot leave half a
      // file that parses into a wrong page.
      const temporary = `${target}.tmp`
      writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600 })
      renameSync(temporary, target)
      this.loaded = stored
      this.loadedScope = scope
    } catch {
      // The cache is a speed-up; losing it only costs the next launch's head start.
    }
  }
}
