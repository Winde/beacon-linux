import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IndexStatus } from '@shared/types'
import { ALL_COLLECTIONS, COLLECTIONS, PLAYABLE, SEARCH } from './queries'
import {
  CATALOG_VERSION,
  type CatalogSnapshot,
  type IndexedCollection,
  type IndexedVideo
} from './catalog-types'
import { displayTitle, episodeCode, normalize, relevance } from './text'
import type { BeaconClient, CatalogLike } from './client'

const INDEX_HOURS = 24
const PAGE_LIMIT = 100
/** Beacon's CMS is happy with a handful of parallel page reads. */
const PAGE_CONCURRENCY = 4

interface SearchableVideo extends IndexedVideo {
  norm: string
  tokens: string[]
  code: string | null
}

interface SearchableCollection extends IndexedCollection {
  norm: string
  tokens: string[]
}

/** The CMS answers untyped JSON; these are the fields the catalog index reads. */
type RawDoc = Record<string, unknown>

interface RawThumb {
  sizes?: {
    landscape?: { url?: string } | null
    landscape2x?: { url?: string } | null
    portrait?: { url?: string } | null
  } | null
}

interface RawVideoDoc {
  id: string
  slug: string
  title: string
  ottTitle?: string | null
  duration?: number | null
  contentType?: string | null
  contentTier?: { name?: string | null; planLevel?: number | null } | null
  thumbnail?: RawThumb | null
  releaseDate?: string | null
  episodeNumber?: number | null
  primaryCollection?: {
    id: string
    name: string
    slug: string
    isSeries?: boolean | null
  } | null
}

interface RawCollectionDoc {
  id: string
  slug: string
  name: string
  isSeries?: boolean | null
  itemCount?: number | null
  releaseDate?: string | null
  thumbnail?: RawThumb | null
}

function indexPath(): string {
  return join(app.getPath('userData'), 'catalog.json')
}

function loadSnapshot(): CatalogSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as CatalogSnapshot
    if (parsed.version !== CATALOG_VERSION) return null
    const usableVideos =
      Array.isArray(parsed.videos) &&
      parsed.videos.length > 0 &&
      parsed.videos.every(
        (video) => video && typeof video.id === 'string' && typeof video.slug === 'string'
      )
    const usableCollections =
      Array.isArray(parsed.collections) &&
      parsed.collections.every(
        (collection) =>
          collection && typeof collection.id === 'string' && typeof collection.slug === 'string'
      )
    if (!usableVideos || !usableCollections) return null
    return parsed
  } catch {
    return null
  }
}

function saveSnapshot(snapshot: CatalogSnapshot): void {
  try {
    mkdirSync(dirname(indexPath()), { recursive: true })
    writeFileSync(indexPath(), JSON.stringify(snapshot))
  } catch {
    // The index is a cache; losing it only costs a rebuild.
  }
}

function rawVideo(input: RawDoc): IndexedVideo {
  const c = input as unknown as RawVideoDoc
  const series = c.primaryCollection ?? null
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    ottTitle: c.ottTitle ?? null,
    duration: c.duration ?? null,
    type: c.contentType ?? null,
    tier: c.contentTier?.name ?? null,
    level: c.contentTier?.planLevel ?? 0,
    image: c.thumbnail?.sizes?.landscape?.url ?? null,
    image2x: c.thumbnail?.sizes?.landscape2x?.url ?? null,
    released: c.releaseDate ?? null,
    episode: c.episodeNumber ?? null,
    series: series
      ? { id: series.id, name: series.name, slug: series.slug, isSeries: Boolean(series.isSeries) }
      : null
  }
}

function rawCollection(input: RawDoc): IndexedCollection {
  const c = input as unknown as RawCollectionDoc
  const sizes = c.thumbnail?.sizes
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    isSeries: Boolean(c.isSeries),
    itemCount: c.itemCount ?? null,
    released: c.releaseDate ?? null,
    image: sizes?.landscape?.url ?? null,
    image2x: sizes?.landscape2x?.url ?? null,
    portrait: sizes?.portrait?.url ?? null
  }
}

/**
 * A local copy of the whole catalog: ~1,300 videos and ~60 series. It powers
 * forgiving search, suggestions, and the "next episode" / "more from this
 * series" rows.
 */
export class Catalog implements CatalogLike {
  private snapshot: CatalogSnapshot | null = loadSnapshot()
  private building: Promise<void> | null = null
  private videosBySlug = new Map<string, IndexedVideo>()
  private collectionsBySlug = new Map<string, IndexedCollection>()
  private videosById = new Map<string, IndexedVideo>()
  private collectionsById = new Map<string, IndexedCollection>()
  private videosBySeries = new Map<string, IndexedVideo[]>()
  private searchableVideos: SearchableVideo[] = []
  private searchableCollections: SearchableCollection[] = []

  constructor(private readonly client: BeaconClient) {
    if (this.snapshot) this.set(this.snapshot)
  }

  private set(snapshot: CatalogSnapshot): void {
    this.snapshot = snapshot
    this.videosBySlug = new Map(snapshot.videos.map((v) => [v.slug, v]))
    this.collectionsBySlug = new Map(snapshot.collections.map((c) => [c.slug, c]))
    // Favourites store ids, so they can be rehydrated from here.
    this.videosById = new Map(snapshot.videos.map((v) => [v.id, v]))
    this.collectionsById = new Map(snapshot.collections.map((c) => [c.id, c]))

    // Episode lists are asked for on every episode page, several times over;
    // group and order them once instead of filtering the whole index each time.
    const bySeries = new Map<string, IndexedVideo[]>()
    for (const video of snapshot.videos) {
      const seriesId = video.series?.id
      if (!seriesId) continue
      const list = bySeries.get(seriesId)
      if (list) list.push(video)
      else bySeries.set(seriesId, [video])
    }
    for (const list of bySeries.values()) {
      list.sort(
        (a, b) =>
          (a.episode ?? 0) - (b.episode ?? 0) ||
          (Date.parse(a.released ?? '') || 0) - (Date.parse(b.released ?? '') || 0)
      )
    }
    this.videosBySeries = bySeries

    this.searchableVideos = snapshot.videos.map((v) => {
      // The editor's short title is what the tile shows, so it has to be
      // searchable too; the full title keeps the episode code findable.
      const display = displayTitle(v)
      return {
        ...v,
        norm: normalize(`${v.title} ${display}`),
        tokens: normalize(`${v.title} ${display} ${v.series?.name ?? ''}`)
          .split(' ')
          .filter(Boolean),
        code: episodeCode(v.title)
      }
    })
    // A collection is more than its name: "Previously On..." holds the Campaign
    // 4 recaps, so searching "recap" has to find it even though the word never
    // appears in the title. Keep `norm` as the name alone, so a name match still
    // earns the phrase bonus, and add the member episodes to the tokens.
    this.searchableCollections = snapshot.collections.map((c) => {
      const own = bySeries.get(c.id) ?? []
      const text = [c.name, ...own.map((v) => `${v.title} ${displayTitle(v)}`)].join(' ')
      return {
        ...c,
        norm: normalize(c.name),
        tokens: [...new Set(normalize(text).split(' ').filter(Boolean))]
      }
    })
  }

  private async fetchPage<T>(
    query: string,
    field: string,
    map: (raw: RawDoc) => T,
    page: number
  ): Promise<{ docs: T[]; totalPages: number }> {
    const r = await this.client.gql<Record<string, { docs?: RawDoc[]; totalPages?: number }>>(
      query,
      { types: PLAYABLE, sort: '-releaseDate', page, limit: PAGE_LIMIT }
    )
    const bucket = r[field]
    if (!bucket) return { docs: [], totalPages: 1 }
    return { docs: (bucket.docs ?? []).map(map), totalPages: bucket.totalPages ?? 1 }
  }

  /**
   * The first page says how many there are; the rest are read a few at a time.
   * A full rebuild used to be a dozen sequential round trips.
   */
  private async fetchPages<T>(
    query: string,
    field: string,
    map: (raw: RawDoc) => T,
    maxPages: number
  ): Promise<T[]> {
    const first = await this.fetchPage(query, field, map, 1)
    const last = Math.min(maxPages, Math.max(1, first.totalPages))
    if (last <= 1) return first.docs

    const pages = Array.from({ length: last - 1 }, (_, index) => index + 2)
    const results: T[][] = new Array(pages.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < pages.length) {
        const index = next++
        results[index] = (await this.fetchPage(query, field, map, pages[index])).docs
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, pages.length) }, () => worker())
    )
    return [...first.docs, ...results.flat()]
  }

  private async build(): Promise<void> {
    const videos = await this.fetchPages(SEARCH, 'search', rawVideo, 100)
    const collections = await this.fetchPages(COLLECTIONS, 'collectionSearch', rawCollection, 50)

    // collectionSearch skips some series; the filter lists have them all, but
    // without pictures, so those borrow the picture of their newest video.
    const lists = await this.client.gql<{
      series?: { docs?: { id: string; name: string; slug: string; releaseDate?: string | null }[] }
      other?: { docs?: { id: string; name: string; slug: string; releaseDate?: string | null }[] }
    }>(ALL_COLLECTIONS)

    const groups: [
      { id: string; name: string; slug: string; releaseDate?: string | null }[],
      boolean
    ][] = [
      [lists.series?.docs ?? [], true],
      [lists.other?.docs ?? [], false]
    ]
    for (const [docs, isSeries] of groups) {
      for (const doc of docs) {
        if (collections.some((c) => c.id === doc.id)) continue
        const own = videos.filter((v) => v.series?.id === doc.id)
        if (!own.length) continue
        collections.push({
          id: doc.id,
          slug: doc.slug,
          name: doc.name,
          isSeries,
          itemCount: own.length,
          // Match the official list: the collection's own release date, not its
          // newest episode. The fallback only matters for the few series that
          // collectionSearch omits.
          released: doc.releaseDate ?? own[0].released,
          image: own[0].image,
          image2x: own[0].image2x,
          portrait: null
        })
      }
    }

    const snapshot: CatalogSnapshot = {
      version: CATALOG_VERSION,
      builtAt: Date.now(),
      videos,
      collections
    }
    this.set(snapshot)
    saveSnapshot(snapshot)
  }

  async ensure(): Promise<void> {
    const stale = !this.snapshot || Date.now() - this.snapshot.builtAt > INDEX_HOURS * 3600 * 1000
    if (stale && !this.building) {
      this.building = this.build()
        .catch((err: Error) => {
          console.warn('[catalog] build failed:', err.message)
          if (!this.snapshot) throw err
        })
        .finally(() => {
          this.building = null
        })
    }
    if (this.snapshot) return
    await this.building
  }

  /**
   * Rebuild now, even when the snapshot is fresh. Used when a page names a
   * collection the index has not seen — the home blocks are editorial and can
   * feature something newer than the last index.
   */
  async refresh(): Promise<void> {
    if (this.building) await this.building.catch(() => {})
    this.building = this.build()
      .catch((err: Error) => {
        // A caller using this to tell "not in the index" from "the CMS could
        // not be read" needs the failure; swallowing it would make a network
        // error look like a deleted series.
        console.warn('[catalog] refresh failed:', err.message)
        throw err
      })
      .finally(() => {
        this.building = null
      })
    await this.building
  }

  status(): IndexStatus {
    return {
      videos: this.snapshot?.videos.length ?? 0,
      collections: this.snapshot?.collections.length ?? 0,
      builtAt: this.snapshot ? new Date(this.snapshot.builtAt).toISOString() : null,
      building: Boolean(this.building)
    }
  }

  videoBySlug(slug: string): IndexedVideo | null {
    return this.videosBySlug.get(slug) ?? null
  }

  collectionBySlug(slug: string): IndexedCollection | null {
    return this.collectionsBySlug.get(slug) ?? null
  }

  /** Every collection the index knows, for the browse screens. */
  allCollections(): IndexedCollection[] {
    return this.snapshot?.collections ?? []
  }

  videoById(id: string): IndexedVideo | null {
    return this.videosById.get(id) ?? null
  }

  collectionById(id: string): IndexedCollection | null {
    return this.collectionsById.get(id) ?? null
  }

  /** Episodes of a series in watching order. */
  seriesVideos(seriesId: string): IndexedVideo[] {
    if (!seriesId) return []
    return this.videosBySeries.get(seriesId) ?? []
  }

  localSearch(
    query: string,
    limit = 40
  ): { collections: IndexedCollection[]; videos: IndexedVideo[] } {
    if (!normalize(query)) return { collections: [], videos: [] }

    const collections = this.searchableCollections
      .map((c) => ({ c, score: relevance(query, c) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.c.itemCount ?? 0) - (a.c.itemCount ?? 0))
      .slice(0, 12)
      .map((x) => x.c)

    // An episode code is an exact identifier, so it outranks any text match.
    const code = episodeCode(query)
    const videos = this.searchableVideos
      .map((v) => ({ v, score: code && v.code === code ? 1.5 : relevance(query, v) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.v)

    return { collections, videos }
  }

  /** Completions while typing: series names, then episode titles. */
  suggest(query: string, limit = 8): string[] {
    const q = normalize(query)
    if (q.length < 2) return []
    const out: string[] = []
    const add = (text: string): void => {
      if (!out.some((o) => normalize(o) === normalize(text))) out.push(text)
    }
    for (const c of this.searchableCollections) {
      // Suggestions are names the member can recognise and retype; a collection
      // matched only through an episode title would look unrelated here.
      if (c.norm.startsWith(q) || c.norm.split(' ').some((token) => token.startsWith(q))) {
        add(c.name)
      }
    }
    for (const v of this.searchableVideos) {
      if (out.length >= limit) break
      const part = [displayTitle(v), v.title]
        .flatMap((title) => title.split('|').map((piece) => piece.trim()))
        .find((piece) => piece && normalize(piece).includes(q))
      if (part) add(part)
    }
    return out.slice(0, limit)
  }
}
