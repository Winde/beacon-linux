import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IndexStatus } from '@shared/types'
import { ALL_COLLECTIONS, COLLECTIONS, PLAYABLE, SEARCH } from './queries'
import type { CatalogSnapshot, IndexedCollection, IndexedVideo } from './catalog-types'
import { episodeCode, normalize, relevance } from './text'
import type { BeaconClient, CatalogLike } from './client'

const INDEX_HOURS = 6
const PAGE_LIMIT = 100

interface SearchableVideo extends IndexedVideo {
  norm: string
  tokens: string[]
  code: string | null
}

interface SearchableCollection extends IndexedCollection {
  norm: string
  tokens: string[]
}

function indexPath(): string {
  return join(app.getPath('userData'), 'catalog.json')
}

function loadSnapshot(): CatalogSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as CatalogSnapshot
    if (!parsed.videos?.length) return null
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

function rawVideo(c: Record<string, any>): IndexedVideo {
  const series = c.primaryCollection ?? null
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    duration: c.duration ?? null,
    type: c.contentType ?? null,
    tier: c.contentTier?.name ?? null,
    level: c.contentTier?.planLevel ?? 0,
    image: c.thumbnail?.sizes?.landscape?.url ?? null,
    released: c.releaseDate ?? null,
    episode: c.episodeNumber ?? null,
    series: series
      ? { id: series.id, name: series.name, slug: series.slug, isSeries: Boolean(series.isSeries) }
      : null
  }
}

function rawCollection(c: Record<string, any>): IndexedCollection {
  const sizes = c.thumbnail?.sizes
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    isSeries: Boolean(c.isSeries),
    itemCount: c.itemCount ?? null,
    released: c.releaseDate ?? null,
    image: sizes?.landscape?.url ?? null,
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
  private searchableVideos: SearchableVideo[] = []
  private searchableCollections: SearchableCollection[] = []

  constructor(private readonly client: BeaconClient) {
    if (this.snapshot) this.set(this.snapshot)
  }

  private set(snapshot: CatalogSnapshot): void {
    this.snapshot = snapshot
    this.videosBySlug = new Map(snapshot.videos.map((v) => [v.slug, v]))
    this.collectionsBySlug = new Map(snapshot.collections.map((c) => [c.slug, c]))
    this.searchableVideos = snapshot.videos.map((v) => ({
      ...v,
      norm: normalize(v.title),
      tokens: normalize(`${v.title} ${v.series?.name ?? ''}`).split(' ').filter(Boolean),
      code: episodeCode(v.title)
    }))
    this.searchableCollections = snapshot.collections.map((c) => ({
      ...c,
      norm: normalize(c.name),
      tokens: normalize(c.name).split(' ').filter(Boolean)
    }))
  }

  private async fetchPages<T>(
    query: string,
    field: string,
    map: (raw: Record<string, any>) => T,
    maxPages: number
  ): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.client.gql<
        Record<string, { docs?: Record<string, any>[]; totalPages?: number }>
      >(query, { types: PLAYABLE, sort: '-releaseDate', page, limit: PAGE_LIMIT })
      const bucket = r[field]
      if (!bucket) break
      out.push(...(bucket.docs ?? []).map(map))
      if (page >= (bucket.totalPages ?? 1)) break
    }
    return out
  }

  private async build(): Promise<void> {
    const videos = await this.fetchPages(SEARCH, 'search', rawVideo, 100)
    const collections = await this.fetchPages(COLLECTIONS, 'collectionSearch', rawCollection, 50)

    // collectionSearch skips some series; the filter lists have them all, but
    // without pictures, so those borrow the picture of their newest video.
    const lists = await this.client.gql<{
      series?: { docs?: { id: string; name: string; slug: string }[] }
      other?: { docs?: { id: string; name: string; slug: string }[] }
    }>(ALL_COLLECTIONS)

    const groups: [{ id: string; name: string; slug: string }[], boolean][] = [
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
          released: own[0].released,
          image: own[0].image,
          portrait: null
        })
      }
    }

    const snapshot: CatalogSnapshot = { builtAt: Date.now(), videos, collections }
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

  /** Episodes of a series in watching order. */
  seriesVideos(seriesId: string): IndexedVideo[] {
    if (!seriesId) return []
    return (this.snapshot?.videos ?? [])
      .filter((v) => v.series?.id === seriesId)
      .sort(
        (a, b) =>
          (a.episode ?? 0) - (b.episode ?? 0) ||
          (Date.parse(a.released ?? '') || 0) - (Date.parse(b.released ?? '') || 0)
      )
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
      if (c.norm.startsWith(q) || c.tokens.some((token) => token.startsWith(q))) add(c.name)
    }
    for (const v of this.searchableVideos) {
      if (out.length >= limit) break
      const part = v.title
        .split('|')
        .map((s) => s.trim())
        .find((p) => normalize(p).includes(q))
      if (part) add(part)
    }
    return out.slice(0, limit)
  }
}
