import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, FavouritesAnchor } from '@shared/types'
import type { CatalogLike } from './beacon/client'
import type { FavouritesApi } from './favourites'
import { FavouritesService } from './favourites'
import type { PreferencesStore } from './preferences'

function collection(id: string, slug: string, name: string) {
  return {
    id,
    slug,
    name,
    isSeries: true,
    itemCount: 12,
    released: null,
    image: `https://images.example/${slug}/format=auto`,
    image2x: null,
    portrait: `https://images.example/${slug}/portrait/format=auto`
  }
}

function harness(options: { email?: string | null; ids?: string[] } = {}) {
  const email = options.email === undefined ? 'member@example.com' : options.email
  const api: FavouritesApi = {
    accountEmail: vi.fn(() => Promise.resolve(email)),
    favouriteCollectionIds: vi.fn(() => Promise.resolve(options.ids ?? ['c1'])),
    setCollectionFavourite: vi.fn(() => Promise.resolve(true))
  }
  const catalog = {
    ensure: vi.fn(() => Promise.resolve()),
    videoBySlug: vi.fn(() => null),
    collectionBySlug: vi.fn((slug: string) =>
      slug === 'campaign-1' ? collection('c1', 'campaign-1', 'Campaign 1') : null
    ),
    videoById: vi.fn(() => null),
    collectionById: vi.fn((id: string) =>
      id === 'c1' ? collection('c1', 'campaign-1', 'Campaign 1') : null
    ),
    seriesVideos: vi.fn(() => []),
    localSearch: vi.fn(() => ({ collections: [], videos: [] })),
    suggest: vi.fn(() => [])
  } as unknown as CatalogLike
  const preferences = {
    favouritesAfter: vi.fn(() => null),
    setFavouritesAfter: vi.fn((value: FavouritesAnchor) => value)
  } as unknown as PreferencesStore
  const service = new FavouritesService(api, catalog, preferences)
  return { service, api, catalog, preferences }
}

const series: Card = {
  kind: 'series',
  id: 'c1',
  slug: 'campaign-1',
  title: 'Campaign 1',
  image: null,
  image2x: null,
  count: 12
}

describe('FavouritesService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows nothing when nobody is signed in', async () => {
    const { service, api } = harness({ email: null })

    await expect(service.list()).resolves.toEqual({ items: [], after: null })
    expect(api.favouriteCollectionIds).not.toHaveBeenCalled()
  })

  it('hydrates the account ids from the catalog', async () => {
    const { service } = harness({ ids: ['c1'] })

    const data = await service.list()

    expect(data.items).toEqual([
      {
        kind: 'series',
        id: 'c1',
        slug: 'campaign-1',
        title: 'Campaign 1',
        image: 'https://images.example/campaign-1/format=auto,width=480',
        image2x: null,
        count: 12
      }
    ])
  })

  it('skips a favourite whose collection is no longer in the catalog', async () => {
    const { service } = harness({ ids: ['gone'] })

    await expect(service.list()).resolves.toEqual({ items: [], after: null })
  })

  it('favourites a series and answers without re-reading the account', async () => {
    const { service, api } = harness({ ids: ['c1'] })

    const data = await service.add(series)

    expect(api.setCollectionFavourite).toHaveBeenCalledWith('c1', true)
    expect(api.favouriteCollectionIds).not.toHaveBeenCalled()
    expect(data.items.map((item) => item.id)).toEqual(['c1'])
  })

  it('adds the series even when the account list has not caught up', async () => {
    const { service } = harness({ ids: [] })

    const data = await service.add(series)

    expect(data.items.map((item) => item.id)).toEqual(['c1'])
  })

  it('does not favourite an episode', async () => {
    const { service, api } = harness()

    await service.add({ ...series, kind: 'video', slug: 'c1e1' })

    expect(api.setCollectionFavourite).not.toHaveBeenCalled()
  })

  it('removes by slug, resolving the id it was shown', async () => {
    const { service, api } = harness({ ids: ['c1'] })
    await service.list()

    const data = await service.remove('campaign-1')

    expect(api.setCollectionFavourite).toHaveBeenCalledWith('c1', false)
    expect(data.items).toEqual([])
  })

  it('moves the row without asking the account again', () => {
    const { service, api, preferences } = harness()

    const data = service.setPosition('featured')

    expect(preferences.setFavouritesAfter).toHaveBeenCalledWith('featured')
    expect(api.favouriteCollectionIds).not.toHaveBeenCalled()
    expect(data.after).toBe('featured')
  })
})
