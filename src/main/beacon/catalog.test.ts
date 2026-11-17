import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { Catalog } from './catalog'
import type { BeaconClient } from './client'
import type { CatalogSnapshot, IndexedVideo } from './catalog-types'

// The index lives under app.getPath('userData'); give each run its own directory.
vi.mock('electron', async () => {
  const { mkdtempSync: make } = await import('node:fs')
  const { tmpdir: temp } = await import('node:os')
  const { join: joinPath } = await import('node:path')
  const directory = make(joinPath(temp(), 'beacon-catalog-'))
  return { app: { getPath: () => directory } }
})

type Raw = Record<string, any>

interface RawCollection {
  id: string
  name: string
  slug: string
  isSeries: boolean
  itemCount: number
}

interface Doc {
  id: string
  name: string
  slug: string
}

interface Call {
  query: string
  variables: Record<string, unknown>
}

interface FakeInput {
  videos?: Raw[]
  collections?: Raw[]
  series?: Doc[]
  other?: Doc[]
  /** Results per page, regardless of the limit the query asks for. */
  pageSize?: number
}

function rawVideo(n: number, overrides: Raw = {}): Raw {
  return {
    id: `v${n}`,
    slug: `episode-${n}`,
    title: `Episode ${n}`,
    duration: 3_600_000,
    contentType: 'video',
    episodeNumber: n,
    releaseDate: `2024-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    contentTier: { name: 'Apprentice', planLevel: 1 },
    primaryCollection: { id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true },
    thumbnail: {
      sizes: {
        landscape: { url: `https://images.example/${n}/format=auto` },
        landscape2x: { url: `https://images.example/${n}x/format=auto` }
      }
    },
    ...overrides
  }
}

function rawCollection(collection: RawCollection): Raw {
  const { id } = collection
  return {
    ...collection,
    releaseDate: '2024-01-01T00:00:00.000Z',
    thumbnail: {
      sizes: {
        landscape: { url: `https://images.example/${id}/landscape/format=auto` },
        landscape2x: { url: `https://images.example/${id}/landscape2x/format=auto` },
        portrait: { url: `https://images.example/${id}/portrait/format=auto` }
      }
    }
  }
}

function indexedVideo(n: number): IndexedVideo {
  return {
    id: `v${n}`,
    slug: `episode-${n}`,
    title: `Episode ${n}`,
    duration: 3_600_000,
    type: 'video',
    tier: 'Apprentice',
    level: 1,
    image: null,
    image2x: null,
    released: '2024-01-01T00:00:00.000Z',
    episode: n,
    series: null
  }
}

function fakeClient(input: FakeInput = {}): { client: BeaconClient; calls: Call[] } {
  const videos = input.videos ?? []
  const collections = input.collections ?? []
  const series = input.series ?? []
  const other = input.other ?? []
  const pageSize = input.pageSize ?? 100
  const calls: Call[] = []

  const paginate = <T>(items: T[], variables: Record<string, unknown>): {
    docs: T[]
    totalPages: number
  } => {
    const page = Number(variables.page ?? 1)
    const start = (page - 1) * pageSize
    return {
      docs: items.slice(start, start + pageSize),
      totalPages: Math.max(1, Math.ceil(items.length / pageSize))
    }
  }

  const client = {
    async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      calls.push({ query, variables })
      if (query.includes('collectionSearch')) {
        return { collectionSearch: paginate(collections, variables) } as unknown as T
      }
      if (query.includes('search(')) {
        return { search: paginate(videos, variables) } as unknown as T
      }
      if (query.includes('series: Collections')) {
        return { series: { docs: series }, other: { docs: other } } as unknown as T
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`)
    }
  }

  return { client: client as unknown as BeaconClient, calls }
}

function indexFile(): string {
  return join(app.getPath('userData'), 'catalog.json')
}

function writeSnapshot(snapshot: CatalogSnapshot): void {
  writeFileSync(indexFile(), JSON.stringify(snapshot))
}

const STALE = 25 * 3600 * 1000

beforeEach(() => {
  rmSync(indexFile(), { force: true })
})

describe('Catalog', () => {
  it('reports an empty status before the first build', () => {
    const { client } = fakeClient()
    expect(new Catalog(client).status()).toEqual({
      videos: 0,
      collections: 0,
      builtAt: null,
      building: false
    })
  })

  it('indexes videos and collections on first use', async () => {
    const { client } = fakeClient({
      videos: [rawVideo(1), rawVideo(2)],
      collections: [rawCollection({ id: 's1', name: 'Campaign 1', slug: 's1', isSeries: true, itemCount: 2 })]
    })
    const catalog = new Catalog(client)

    await catalog.ensure()

    expect(catalog.status()).toMatchObject({ videos: 2, collections: 1, building: false })
    expect(catalog.status().builtAt).not.toBeNull()
    expect(catalog.videoBySlug('episode-1')).toMatchObject({
      id: 'v1',
      slug: 'episode-1',
      title: 'Episode 1',
      duration: 3_600_000,
      type: 'video',
      tier: 'Apprentice',
      level: 1,
      image: 'https://images.example/1/format=auto',
      image2x: 'https://images.example/1x/format=auto',
      released: '2024-01-01T00:00:00.000Z',
      episode: 1,
      series: { id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true }
    })
    expect(catalog.collectionBySlug('s1')).toMatchObject({
      id: 's1',
      name: 'Campaign 1',
      isSeries: true,
      itemCount: 2,
      image: 'https://images.example/s1/landscape/format=auto',
      portrait: 'https://images.example/s1/portrait/format=auto'
    })
  })

  it('finds entries by the ids the favourites store', async () => {
    const { client } = fakeClient({
      videos: [rawVideo(1)],
      collections: [
        rawCollection({ id: 's1', name: 'Campaign 1', slug: 's1', isSeries: true, itemCount: 1 })
      ]
    })
    const catalog = new Catalog(client)
    await catalog.ensure()

    expect(catalog.videoById('v1')).toMatchObject({ slug: 'episode-1', title: 'Episode 1' })
    expect(catalog.collectionById('s1')).toMatchObject({ slug: 's1', name: 'Campaign 1' })
    expect(catalog.videoById('missing')).toBeNull()
    expect(catalog.collectionById('missing')).toBeNull()
  })

  it('tolerates sparse records', async () => {
    const { client } = fakeClient({
      videos: [
        rawVideo(1, {
          duration: null,
          contentType: null,
          contentTier: null,
          primaryCollection: null,
          thumbnail: null
        })
      ]
    })
    const catalog = new Catalog(client)

    await catalog.ensure()

    expect(catalog.videoBySlug('episode-1')).toMatchObject({
      duration: null,
      type: null,
      tier: null,
      level: 0,
      image: null,
      image2x: null,
      series: null
    })
  })

  it('returns null for unknown slugs', async () => {
    const { client } = fakeClient()
    const catalog = new Catalog(client)
    await catalog.ensure()

    expect(catalog.videoBySlug('missing')).toBeNull()
    expect(catalog.collectionBySlug('missing')).toBeNull()
  })

  it('pages through every result', async () => {
    const videos = Array.from({ length: 5 }, (_, index) => rawVideo(index + 1))
    const { client, calls } = fakeClient({ videos, pageSize: 2 })
    const catalog = new Catalog(client)

    await catalog.ensure()

    expect(catalog.status().videos).toBe(5)
    const pages = calls.filter((call) => call.query.includes('search(')).map((call) => call.variables.page)
    expect(pages).toEqual([1, 2, 3])
  })

  it('builds only once when several callers ask at the same time', async () => {
    const { client, calls } = fakeClient({ videos: [rawVideo(1)] })
    const catalog = new Catalog(client)

    await Promise.all([catalog.ensure(), catalog.ensure(), catalog.ensure()])

    expect(calls.filter((call) => call.query.includes('search('))).toHaveLength(1)
  })

  it('orders a series by episode', async () => {
    const s2 = { id: 's2', name: 'Campaign 2', slug: 'campaign-2', isSeries: true }
    const videos = [
      rawVideo(3),
      rawVideo(1),
      rawVideo(2),
      rawVideo(9, { episodeNumber: 1, primaryCollection: s2 })
    ]
    const { client } = fakeClient({ videos })
    const catalog = new Catalog(client)
    await catalog.ensure()

    expect(catalog.seriesVideos('s1').map((v) => v.episode)).toEqual([1, 2, 3])
    expect(catalog.seriesVideos('s2').map((v) => v.slug)).toEqual(['episode-9'])
    expect(catalog.seriesVideos('')).toEqual([])
  })

  it('needs the collection search and the filter lists that complete it', async () => {
    const series = { id: 's2', name: 'Campaign 2', slug: 'campaign-2', isSeries: true }
    const other = { id: 'c9', name: 'One Shots', slug: 'one-shots', isSeries: false }
    const videos = [
      rawVideo(1),
      rawVideo(2),
      rawVideo(4, { primaryCollection: series }),
      rawVideo(5, { primaryCollection: series }),
      rawVideo(6, { primaryCollection: other })
    ]
    const { client } = fakeClient({
      videos,
      collections: [
        rawCollection({ id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true, itemCount: 2 })
      ],
      series: [
        series,
        { id: 's3', name: 'Campaign 3', slug: 'campaign-3' } // no videos in the index
      ],
      other: [other]
    })
    const catalog = new Catalog(client)

    await catalog.ensure()

    expect(catalog.status().collections).toBe(3)
    // Absent from the collection search: rebuilt from its videos, with the newest one's art.
    expect(catalog.collectionBySlug('campaign-2')).toMatchObject({
      isSeries: true,
      itemCount: 2,
      image: 'https://images.example/4/format=auto',
      portrait: null
    })
    expect(catalog.collectionBySlug('one-shots')).toMatchObject({ isSeries: false, itemCount: 1 })
    expect(catalog.collectionBySlug('campaign-3')).toBeNull()
  })

  describe('localSearch', () => {
    it('returns nothing for a blank query', async () => {
      const { client } = fakeClient({ videos: [rawVideo(1)] })
      const catalog = new Catalog(client)
      await catalog.ensure()

      expect(catalog.localSearch('')).toEqual({ collections: [], videos: [] })
      expect(catalog.localSearch('   ')).toEqual({ collections: [], videos: [] })
    })

    it('ranks an episode code ahead of a title match', async () => {
      const videos = [
        rawVideo(1, { title: 'C4E12 Wrap-Up' }),
        rawVideo(2, { title: 'Campaign 4: Behind the Episode 12' }),
        rawVideo(3, { title: 'Campaign 3: Behind the Episode 12' })
      ]
      const { client } = fakeClient({ videos })
      const catalog = new Catalog(client)
      await catalog.ensure()

      const result = catalog.localSearch('campaign 4 episode 12')

      expect(result.videos.map((v) => v.slug)).toEqual(['episode-1', 'episode-2', 'episode-3'])
    })

    it('ranks collections by name match, then by size', async () => {
      const { client } = fakeClient({
        collections: [
          rawCollection({ id: 'campaign-4', name: 'Campaign 4', slug: 'campaign-4', isSeries: true, itemCount: 2 }),
          rawCollection({ id: 'campaign-1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true, itemCount: 10 })
        ]
      })
      const catalog = new Catalog(client)
      await catalog.ensure()

      expect(catalog.localSearch('campaign').collections.map((c) => c.slug)).toEqual([
        'campaign-1',
        'campaign-4'
      ])
    })

    it('honours the video limit', async () => {
      const videos = Array.from({ length: 5 }, (_, index) =>
        rawVideo(index + 1, { title: `Campaign 1 episode ${index + 1}` })
      )
      const { client } = fakeClient({ videos })
      const catalog = new Catalog(client)
      await catalog.ensure()

      expect(catalog.localSearch('campaign', 2).videos).toHaveLength(2)
    })
  })

  describe('suggest', () => {
    async function suggestCatalog(): Promise<Catalog> {
      const { client } = fakeClient({
        videos: [
          rawVideo(1, { title: 'Campaign 1 | Episode 1' }),
          rawVideo(2, { title: 'The Legend of Vox Machina | Campaign 1 Preview' })
        ],
        collections: [
          rawCollection({ id: 'campaign-1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true, itemCount: 2 })
        ]
      })
      const catalog = new Catalog(client)
      await catalog.ensure()
      return catalog
    }

    it('waits for at least two characters', async () => {
      const catalog = await suggestCatalog()
      expect(catalog.suggest('c')).toEqual([])
      expect(catalog.suggest('')).toEqual([])
    })

    it('offers series names and episode titles without duplicates', async () => {
      const catalog = await suggestCatalog()
      expect(catalog.suggest('cam')).toEqual(['Campaign 1', 'Campaign 1 Preview'])
    })

    it('honours the limit', async () => {
      const catalog = await suggestCatalog()
      expect(catalog.suggest('cam', 1)).toEqual(['Campaign 1'])
    })

    it('returns nothing when nothing matches', async () => {
      const catalog = await suggestCatalog()
      expect(catalog.suggest('zzz')).toEqual([])
    })
  })

  describe('saved index', () => {
    it('is written once the build finishes', async () => {
      const { client } = fakeClient({ videos: [rawVideo(1), rawVideo(2)] })
      const catalog = new Catalog(client)
      await catalog.ensure()

      const saved = JSON.parse(readFileSync(indexFile(), 'utf8')) as CatalogSnapshot
      expect(saved.videos).toHaveLength(2)
      expect(saved.builtAt).toBeGreaterThan(0)
    })

    it('is reused instead of rebuilding', async () => {
      const { client } = fakeClient({ videos: [rawVideo(1), rawVideo(2)] })
      await new Catalog(client).ensure()

      const offline = { gql: vi.fn().mockRejectedValue(new Error('offline')) }
      const catalog = new Catalog(offline as unknown as BeaconClient)
      expect(catalog.status().videos).toBe(2)

      await catalog.ensure()

      expect(offline.gql).not.toHaveBeenCalled()
      expect(catalog.status().videos).toBe(2)
    })

    it('is rebuilt when older than the freshness window', async () => {
      writeSnapshot({ builtAt: Date.now() - STALE, videos: [indexedVideo(99)], collections: [] })
      const { client } = fakeClient({ videos: [rawVideo(1), rawVideo(2)] })
      const catalog = new Catalog(client)
      expect(catalog.status().videos).toBe(1)

      // A stale index is served immediately; the rebuild happens behind it.
      await catalog.ensure()
      await vi.waitFor(() => expect(catalog.status().videos).toBe(2))
    })

    it('is ignored when it cannot be parsed', async () => {
      writeFileSync(indexFile(), '{ not json')
      const { client } = fakeClient({ videos: [rawVideo(1)] })
      const catalog = new Catalog(client)

      await catalog.ensure()

      expect(catalog.status().videos).toBe(1)
    })

    it('is ignored when it holds no videos', async () => {
      writeSnapshot({ builtAt: Date.now(), videos: [], collections: [] })
      const { client } = fakeClient({ videos: [rawVideo(1)] })
      const catalog = new Catalog(client)

      await catalog.ensure()

      expect(catalog.status().videos).toBe(1)
    })
  })

  describe('failures', () => {
    const failing = (): BeaconClient =>
      ({ gql: vi.fn().mockRejectedValue(new Error('network down')) }) as unknown as BeaconClient

    it('surfaces a build failure when there is no saved index', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const catalog = new Catalog(failing())

      await expect(catalog.ensure()).rejects.toThrow('network down')

      expect(warn).toHaveBeenCalled()
      expect(catalog.status().videos).toBe(0)
    })

    it('keeps the saved index when a rebuild fails', async () => {
      writeSnapshot({ builtAt: Date.now() - STALE, videos: [indexedVideo(7)], collections: [] })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const catalog = new Catalog(failing())

      await expect(catalog.ensure()).resolves.toBeUndefined()
      await vi.waitFor(() => expect(warn).toHaveBeenCalled())

      expect(warn).toHaveBeenCalled()
      expect(catalog.status().videos).toBe(1)
      expect(catalog.videoBySlug('episode-7')).not.toBeNull()
    })
  })
})
