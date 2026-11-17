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

function harness(
  options: {
    email?: string | null
    ids?: string[]
    set?: FavouritesApi['setCollectionFavourite']
    collections?: { id: string; slug: string; name: string }[]
  } = {}
) {
  const email = options.email === undefined ? 'member@example.com' : options.email
  const collections = options.collections ?? [{ id: 'c1', slug: 'campaign-1', name: 'Campaign 1' }]
  const byId = new Map(
    collections.map((entry) => [entry.id, collection(entry.id, entry.slug, entry.name)])
  )
  const bySlug = new Map(
    collections.map((entry) => [entry.slug, collection(entry.id, entry.slug, entry.name)])
  )
  const api: FavouritesApi = {
    accountEmail: vi.fn(() => Promise.resolve(email)),
    favouriteCollectionIds: vi.fn(() => Promise.resolve(options.ids ?? ['c1'])),
    // By default the account takes the write and answers with the new state.
    setCollectionFavourite:
      options.set ?? vi.fn((_id: string, favourite: boolean) => Promise.resolve(favourite))
  }
  const catalog = {
    ensure: vi.fn(() => Promise.resolve()),
    videoBySlug: vi.fn(() => null),
    collectionBySlug: vi.fn((slug: string) => bySlug.get(slug) ?? null),
    videoById: vi.fn(() => null),
    collectionById: vi.fn((id: string) => byId.get(id) ?? null),
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

  it('leaves the row alone when the account refuses the add', async () => {
    const set = vi.fn<FavouritesApi['setCollectionFavourite']>().mockResolvedValue(false)
    const { service, api } = harness({ ids: [], set })

    const data = await service.add(series)

    expect(api.setCollectionFavourite).toHaveBeenCalledWith('c1', true)
    expect(data.items).toEqual([])
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

  it('keeps the row when the account refuses the remove', async () => {
    const set = vi.fn<FavouritesApi['setCollectionFavourite']>().mockResolvedValue(true)
    const { service, api } = harness({ ids: ['c1'], set })
    await service.list()

    const data = await service.remove('campaign-1')

    expect(api.setCollectionFavourite).toHaveBeenCalledWith('c1', false)
    expect(data.items.map((item) => item.id)).toEqual(['c1'])
  })

  it('moves the row without asking the account again', () => {
    const { service, api, preferences } = harness()

    const data = service.setPosition('featured')

    expect(preferences.setFavouritesAfter).toHaveBeenCalledWith('featured')
    expect(api.favouriteCollectionIds).not.toHaveBeenCalled()
    expect(data.after).toBe('featured')
  })

  it('rejects a failed account read instead of reporting an empty account', async () => {
    const { service, api } = harness()
    vi.mocked(api.favouriteCollectionIds).mockRejectedValue(new Error('offline'))

    await expect(service.list()).rejects.toThrow('offline')
  })

  it('runs writes in order, so the later answer still lists the earlier series', async () => {
    const pending: ((value: boolean) => void)[] = []
    const set = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          pending.push(resolve)
        })
    )
    const { service } = harness({
      ids: [],
      set,
      collections: [
        { id: 'c1', slug: 'campaign-1', name: 'Campaign 1' },
        { id: 'c2', slug: 'campaign-2', name: 'Campaign 2' }
      ]
    })
    const second: Card = {
      ...series,
      id: 'c2',
      slug: 'campaign-2',
      title: 'Campaign 2'
    }

    const firstWrite = service.add(series)
    const secondWrite = service.add(second)

    // The second write waits for the first, rather than racing it.
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    pending[0]!(true)
    await firstWrite

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    pending[1]!(true)
    const data = await secondWrite

    expect(data.items.map((item) => item.id)).toEqual(['c2', 'c1'])
  })

  it('keeps accepting writes after one fails', async () => {
    const set = vi
      .fn<FavouritesApi['setCollectionFavourite']>()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(true)
    const { service } = harness({
      ids: [],
      set,
      collections: [
        { id: 'c1', slug: 'campaign-1', name: 'Campaign 1' },
        { id: 'c2', slug: 'campaign-2', name: 'Campaign 2' }
      ]
    })
    const second: Card = {
      ...series,
      id: 'c2',
      slug: 'campaign-2',
      title: 'Campaign 2'
    }

    await expect(service.add(series)).rejects.toThrow('refused')
    const data = await service.add(second)

    expect(data.items.map((item) => item.id)).toEqual(['c2'])
  })
})
