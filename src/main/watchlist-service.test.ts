import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@shared/types'
import type { CatalogLike } from './beacon/client'
import type { IndexedCollection, IndexedVideo } from './beacon/catalog-types'
import { WatchlistService } from './watchlist-service'
import { WatchlistStore } from './watchlist'

const MEMBER = 'member@example.com'

function video(overrides: Partial<IndexedVideo> = {}): IndexedVideo {
  return {
    id: 'v1',
    slug: 'c1e1',
    title: 'Campaign 1 Episode 1',
    duration: 3_300_000,
    type: 'video',
    tier: 'Apprentice',
    level: 1,
    image: 'https://images.example/v1/format=auto',
    image2x: 'https://images.example/v1x/format=auto',
    released: '2024-01-01T00:00:00.000Z',
    episode: 1,
    series: { id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true },
    ...overrides
  }
}

function collection(overrides: Partial<IndexedCollection> = {}): IndexedCollection {
  return {
    id: 's1',
    slug: 'campaign-1',
    name: 'Campaign 1',
    isSeries: true,
    itemCount: 96,
    released: '2024-01-01T00:00:00.000Z',
    image: 'https://images.example/s1/format=auto',
    image2x: 'https://images.example/s1x/format=auto',
    portrait: null,
    ...overrides
  }
}

function fakeCatalog(
  options: { videos?: IndexedVideo[]; collections?: IndexedCollection[] } = {}
): CatalogLike {
  const videos = options.videos ?? []
  const collections = options.collections ?? []
  return {
    ensure: vi.fn(async () => undefined),
    videoBySlug: (slug) => videos.find((item) => item.slug === slug) ?? null,
    collectionBySlug: (slug) => collections.find((item) => item.slug === slug) ?? null,
    videoById: (id) => videos.find((item) => item.id === id) ?? null,
    collectionById: (id) => collections.find((item) => item.id === id) ?? null,
    seriesVideos: () => [],
    localSearch: () => ({ collections: [], videos: [] }),
    suggest: () => []
  }
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    kind: 'video',
    id: 'v1',
    slug: 'c1e1',
    title: 'Campaign 1 Episode 1',
    subtitle: 'Campaign 1',
    image: 'https://images.example/v1/format=auto',
    minutes: 55,
    ...overrides
  }
}

let store: WatchlistStore

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'beacon-watchlist-service-'))
  store = new WatchlistStore(() => join(directory, 'watchlist.json'))
})

describe('WatchlistService', () => {
  it('hydrates saved ids from the local catalog', async () => {
    store.add(MEMBER, { kind: 'video', id: 'v1', addedAt: 111 })
    store.add(MEMBER, { kind: 'series', id: 's1', addedAt: 222 })
    const service = new WatchlistService(
      store,
      fakeCatalog({ videos: [video()], collections: [collection()] })
    )

    const data = await service.list(MEMBER)

    expect(data.items).toEqual([
      {
        kind: 'series',
        id: 's1',
        slug: 'campaign-1',
        title: 'Campaign 1',
        subtitle: '',
        image: 'https://images.example/s1/format=auto,width=480',
        image2x: 'https://images.example/s1x/format=auto,width=480',
        minutes: null,
        count: 96,
        addedAt: 222
      },
      {
        kind: 'video',
        id: 'v1',
        slug: 'c1e1',
        title: 'Campaign 1 Episode 1',
        subtitle: 'Campaign 1',
        image: 'https://images.example/v1/format=auto,width=480',
        image2x: 'https://images.example/v1x/format=auto,width=480',
        minutes: 55,
        count: null,
        addedAt: 111
      }
    ])
  })

  it('saves the id the card already carries', async () => {
    const service = new WatchlistService(store, fakeCatalog())

    const data = await service.add(MEMBER, card({ id: 'v9', slug: 'new', title: 'Just saved' }))

    expect(data.items[0]).toMatchObject({
      kind: 'video',
      id: 'v9',
      slug: 'new',
      title: 'Just saved'
    })
    expect(store.list(MEMBER).items).toEqual([{ kind: 'video', id: 'v9', addedAt: expect.any(Number) }])
  })

  it('resolves an id from the catalog when the card has none', async () => {
    const service = new WatchlistService(store, fakeCatalog({ videos: [video()] }))

    await service.add(MEMBER, card({ id: undefined }))

    expect(store.list(MEMBER).items.map((item) => item.id)).toEqual(['v1'])
  })

  it('does not save a title it cannot identify', async () => {
    const service = new WatchlistService(store, fakeCatalog())

    const data = await service.add(MEMBER, card({ id: undefined, slug: 'missing' }))

    expect(data.items).toEqual([])
    expect(store.list(MEMBER).items).toEqual([])
  })

  it('keeps the just-saved card on screen before the catalog knows it', async () => {
    const service = new WatchlistService(store, fakeCatalog())
    await service.add(MEMBER, card({ id: 'v9', slug: 'new', title: 'Brand new' }))

    const data = await service.list(MEMBER)

    expect(data.items).toHaveLength(1)
    expect(data.items[0].title).toBe('Brand new')
  })

  it('removes by the slug the row shows', async () => {
    store.add(MEMBER, { kind: 'video', id: 'v1', addedAt: 1 })
    const service = new WatchlistService(store, fakeCatalog({ videos: [video()] }))
    await service.list(MEMBER)

    const data = await service.remove(MEMBER, 'video', 'c1e1')

    expect(data.items).toEqual([])
    expect(store.list(MEMBER).items).toEqual([])
  })

  it('keeps the catalog copy ahead of a stale card cache', async () => {
    const service = new WatchlistService(store, fakeCatalog({ videos: [video()] }))
    await service.add(MEMBER, card({ title: 'Old title' }))

    const data = await service.list(MEMBER)

    expect(data.items[0].title).toBe('Campaign 1 Episode 1')
  })

  it('stores the row position and forgets everything on clear', async () => {
    const service = new WatchlistService(store, fakeCatalog({ videos: [video()] }))
    await service.add(MEMBER, card())

    expect((await service.setPosition(MEMBER, 2)).rowsAbove).toBe(2)
    expect((await service.list(MEMBER)).rowsAbove).toBe(2)
    expect(service.clear(MEMBER)).toEqual({ items: [], rowsAbove: null })
    expect((await service.list(MEMBER)).items).toEqual([])
  })
})
