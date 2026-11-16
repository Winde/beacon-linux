import type { Card, WatchlistData, WatchlistItem } from '@shared/types'
import type { IndexedCollection, IndexedVideo } from './beacon/catalog-types'
import type { CatalogLike } from './beacon/client'
import { imageUrl } from './beacon/text'
import type { StoredWatchlist, WatchlistEntry, WatchlistStore } from './watchlist'

const minutes = (ms: number | null | undefined): number | null =>
  ms ? Math.max(1, Math.round(ms / 60000)) : null

const keyOf = (kind: Card['kind'], id: string): string => `${kind}:${id}`

function itemFromVideo(video: IndexedVideo, addedAt: number): WatchlistItem {
  return {
    kind: 'video',
    id: video.id,
    slug: video.slug,
    title: video.title,
    subtitle: video.series?.name ?? '',
    image: imageUrl(video.image, 480),
    image2x: imageUrl(video.image2x, 480),
    minutes: minutes(video.duration),
    count: null,
    addedAt
  }
}

function itemFromCollection(collection: IndexedCollection, addedAt: number): WatchlistItem {
  return {
    kind: 'series',
    id: collection.id,
    slug: collection.slug,
    title: collection.name,
    subtitle: '',
    image: imageUrl(collection.image ?? collection.portrait, 480),
    image2x: imageUrl(collection.image2x, 480),
    minutes: null,
    count: collection.itemCount,
    addedAt
  }
}

function itemFromCard(card: Card, id: string, addedAt: number): WatchlistItem {
  return {
    kind: card.kind,
    id,
    slug: card.slug,
    title: card.title,
    subtitle: card.subtitle ?? '',
    image: card.image,
    image2x: card.image2x ?? null,
    minutes: card.minutes ?? null,
    count: card.count ?? null,
    addedAt
  }
}

/**
 * Bridges the ids that are persisted and the cards Home draws.
 *
 * The store is the source of truth. Everything else here is a cache: the local
 * catalog is asked to name each saved id, and a card the member just saved is
 * kept in memory so the row updates before a catalog lookup can answer.
 */
export class WatchlistService {
  private readonly cache = new Map<string, WatchlistItem>()

  constructor(
    private readonly store: WatchlistStore,
    private readonly catalog: CatalogLike
  ) {}

  async list(email: string | null): Promise<WatchlistData> {
    return this.hydrate(this.store.list(email))
  }

  async add(email: string | null, card: Card): Promise<WatchlistData> {
    const id = await this.idForCard(card)
    // Nothing stable to persist: leave the list as it is rather than save a
    // snapshot the next launch cannot resolve.
    if (!id) return this.list(email)
    const addedAt = Date.now()
    this.cache.set(keyOf(card.kind, id), itemFromCard(card, id, addedAt))
    return this.hydrate(this.store.add(email, { kind: card.kind, id, addedAt }))
  }

  async remove(email: string | null, kind: Card['kind'], slug: string): Promise<WatchlistData> {
    const current = await this.hydrate(this.store.list(email))
    const match = current.items.find((item) => item.kind === kind && item.slug === slug)
    if (!match) return current
    return this.hydrate(this.store.remove(email, kind, match.id))
  }

  async setPosition(email: string | null, rowsAbove: number): Promise<WatchlistData> {
    return this.hydrate(this.store.setPosition(email, rowsAbove))
  }

  clear(email: string | null): WatchlistData {
    this.store.clear(email)
    return { items: [], rowsAbove: null }
  }

  /** Resolve what a card points at without trusting slugs across launches. */
  private async idForCard(card: Card): Promise<string | null> {
    if (card?.id) return card.id
    await this.catalog.ensure().catch(() => {})
    const known =
      card?.kind === 'video'
        ? this.catalog.videoBySlug(card.slug)
        : this.catalog.collectionBySlug(card?.slug ?? '')
    return known?.id ?? null
  }

  private async hydrate(stored: StoredWatchlist): Promise<WatchlistData> {
    // The catalog is already in memory on any launch after the first (it is
    // written to disk), so this only waits on the rare cold, non-empty list.
    // An empty list must never delay boot with a catalog build.
    if (stored.items.length) await this.catalog.ensure().catch(() => {})
    const items: WatchlistItem[] = []
    for (const entry of stored.items) {
      const item = this.hydrateEntry(entry)
      if (item) items.push(item)
    }
    return { items, rowsAbove: stored.rowsAbove }
  }

  private hydrateEntry(entry: WatchlistEntry): WatchlistItem | null {
    // The catalog is refreshed from Beacon; its copy wins over a stale cache.
    const video = entry.kind === 'video' ? this.catalog.videoById(entry.id) : null
    const collection =
      entry.kind === 'series' ? this.catalog.collectionById(entry.id) : null
    const fresh = video
      ? itemFromVideo(video, entry.addedAt)
      : collection
        ? itemFromCollection(collection, entry.addedAt)
        : null
    if (fresh) {
      this.cache.set(keyOf(entry.kind, entry.id), fresh)
      return fresh
    }
    return this.cache.get(keyOf(entry.kind, entry.id)) ?? null
  }
}
