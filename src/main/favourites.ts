import type { Card, FavouriteItem, FavouritesData } from '@shared/types'
import type { CatalogLike } from './beacon/client'
import type { IndexedCollection } from './beacon/catalog-types'
import { imageUrl } from './beacon/text'
import type { PreferencesStore } from './preferences'

/** The Beacon calls this service makes, kept narrow for tests. */
export interface FavouritesApi {
  accountEmail(): Promise<string | null>
  favouriteCollectionIds(): Promise<string[]>
  setCollectionFavourite(id: string, favourite: boolean): Promise<boolean>
}

function itemFromCollection(collection: IndexedCollection): FavouriteItem {
  return {
    kind: 'series',
    id: collection.id,
    slug: collection.slug,
    title: collection.name,
    image: imageUrl(collection.image ?? collection.portrait, 480),
    image2x: imageUrl(collection.image2x, 480),
    count: collection.itemCount
  }
}

/**
 * Beacon's favourites, hydrated for Home.
 *
 * The account is the source of truth: read the member's collections, then ask
 * the local catalog to name each one. Nothing is written here except where the
 * row sits, and signing out simply leaves nothing to show.
 */
export class FavouritesService {
  /** The last answer, so the row's arrows need no new round trip. */
  private readonly shown = new Map<string, FavouriteItem>()

  constructor(
    private readonly api: FavouritesApi,
    private readonly catalog: CatalogLike,
    private readonly preferences: PreferencesStore
  ) {}

  async list(): Promise<FavouritesData> {
    const rowsAbove = this.preferences.rowsAbove()
    if (!(await this.api.accountEmail())) return this.snapshot([], rowsAbove)
    const ids = await this.api.favouriteCollectionIds().catch(() => [])
    if (!ids.length) return this.snapshot([], rowsAbove)
    // Cold boots have the catalog on disk; this only waits the first time.
    await this.catalog.ensure().catch(() => {})
    const items: FavouriteItem[] = []
    for (const id of ids) {
      const collection = this.catalog.collectionById(id)
      if (collection) items.push(itemFromCollection(collection))
      // A favourite can outlive its collection; the cached copy keeps the row
      // stable for this run rather than making it flicker.
      else if (this.shown.has(id)) items.push(this.shown.get(id)!)
    }
    return this.snapshot(items, rowsAbove)
  }

  /** Favourites are collections only: an episode has no favourite of its own. */
  async add(card: Card): Promise<FavouritesData> {
    const rowsAbove = this.preferences.rowsAbove()
    if (!card || card.kind !== 'series') return this.snapshot([...this.shown.values()], rowsAbove)
    const id = card.id ?? (await this.idForSlug(card.slug))
    if (!id) return this.snapshot([...this.shown.values()], rowsAbove)
    await this.api.setCollectionFavourite(id, true)
    // No list read follows the write: the row was already read, and a second
    // read can trail the write and make the just-favourited series disappear.
    const collection = this.catalog.collectionById(id)
    const items = [...this.shown.values()].filter((item) => item.id !== id)
    items.unshift(
      collection
        ? itemFromCollection(collection)
        : {
            kind: 'series',
            id,
            slug: card.slug,
            title: card.title,
            image: card.image ?? null,
            image2x: card.image2x ?? null,
            count: card.count ?? null
          }
    )
    return this.snapshot(items, rowsAbove)
  }

  async remove(slug: string): Promise<FavouritesData> {
    const id = await this.idForSlug(slug)
    const rowsAbove = this.preferences.rowsAbove()
    if (!id) return this.snapshot([...this.shown.values()], rowsAbove)
    await this.api.setCollectionFavourite(id, false)
    return this.snapshot(
      [...this.shown.values()].filter((item) => item.id !== id),
      rowsAbove
    )
  }

  /** Moving the row is local, so it must not re-read the account. */
  setPosition(rowsAbove: number): FavouritesData {
    const value = this.preferences.setRowsAbove(rowsAbove)
    return { items: [...this.shown.values()], rowsAbove: value }
  }

  private async idForSlug(slug: string): Promise<string | null> {
    for (const item of this.shown.values()) if (item.slug === slug) return item.id
    await this.catalog.ensure().catch(() => {})
    return this.catalog.collectionBySlug(slug)?.id ?? null
  }

  private snapshot(items: FavouriteItem[], rowsAbove: number | null): FavouritesData {
    this.shown.clear()
    for (const item of items) this.shown.set(item.id, item)
    return { items, rowsAbove }
  }
}
