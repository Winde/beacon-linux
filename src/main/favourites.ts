import type { Card, FavouriteItem, FavouritesAnchor, FavouritesData } from '@shared/types'
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
 * the local catalog to name each one. Nothing is written here except which
 * shelf their row follows, and signing out simply leaves nothing to show.
 */
export class FavouritesService {
  /** The last answer, so the row's arrows need no new round trip. */
  private readonly shown = new Map<string, FavouriteItem>()
  /**
   * Writes go out one at a time. Every answer is built from `shown`, so two
   * finishing together would let the earlier one drop the later one's series.
   */
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly api: FavouritesApi,
    private readonly catalog: CatalogLike,
    private readonly preferences: PreferencesStore
  ) {}

  /**
   * Beacon's list. A failed read rejects rather than looking like an empty
   * account, so the caller can keep the row that is already on screen.
   */
  async list(): Promise<FavouritesData> {
    const after = this.preferences.favouritesAfter()
    if (!(await this.api.accountEmail())) return this.snapshot([], after)
    const ids = await this.api.favouriteCollectionIds()
    if (!ids.length) return this.snapshot([], after)
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
    return this.snapshot(items, after)
  }

  /** Favourites are collections only: an episode has no favourite of its own. */
  async add(card: Card): Promise<FavouritesData> {
    return this.enqueue(() => this.writeAdd(card))
  }

  async remove(slug: string): Promise<FavouritesData> {
    return this.enqueue(() => this.writeRemove(slug))
  }

  /** Run one write after the previous one has settled, successfully or not. */
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.writes.catch(() => undefined).then(run)
    this.writes = task.catch(() => undefined)
    return task
  }

  private async writeAdd(card: Card): Promise<FavouritesData> {
    const after = this.preferences.favouritesAfter()
    if (!card || card.kind !== 'series') return this.snapshot([...this.shown.values()], after)
    const id = card.id ?? (await this.idForSlug(card.slug))
    if (!id) return this.snapshot([...this.shown.values()], after)
    // Beacon can accept the mutation and still answer that the collection is
    // not favourited. Trust that answer: adding the row anyway would show a
    // favourite the account does not have.
    if (!(await this.api.setCollectionFavourite(id, true))) {
      return this.snapshot([...this.shown.values()], after)
    }
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
    return this.snapshot(items, after)
  }

  private async writeRemove(slug: string): Promise<FavouritesData> {
    const id = await this.idForSlug(slug)
    const after = this.preferences.favouritesAfter()
    if (!id) return this.snapshot([...this.shown.values()], after)
    // A write that leaves the collection favourited must keep the row, or the
    // next read would bring back a series the row had already dropped.
    if (await this.api.setCollectionFavourite(id, false)) {
      return this.snapshot([...this.shown.values()], after)
    }
    return this.snapshot(
      [...this.shown.values()].filter((item) => item.id !== id),
      after
    )
  }

  /** Moving the row is local, so it must not re-read the account. */
  setPosition(after: FavouritesAnchor): FavouritesData {
    const value = this.preferences.setFavouritesAfter(after)
    return { items: [...this.shown.values()], after: value }
  }

  private async idForSlug(slug: string): Promise<string | null> {
    for (const item of this.shown.values()) if (item.slug === slug) return item.id
    await this.catalog.ensure().catch(() => {})
    return this.catalog.collectionBySlug(slug)?.id ?? null
  }

  private snapshot(items: FavouriteItem[], after: FavouritesAnchor | null): FavouritesData {
    this.shown.clear()
    for (const item of items) this.shown.set(item.id, item)
    return { items, after }
  }
}
