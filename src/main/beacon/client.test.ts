import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Q from './queries'
import type { IndexedCollection, IndexedVideo } from './catalog-types'
import type { CatalogLike } from './client'
import type { HomeStore } from '../home-store'
import type { PageStore } from '../page-store'
import { BeaconClient, BeaconError, MARK_RETRIES } from './client'

const net = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: net.fetch } }))
vi.mock('./session', () => ({ loadSession: vi.fn(), saveSession: vi.fn() }))

import { loadSession, saveSession } from './session'

type Routes = Record<string, (variables: Record<string, any>) => unknown>
type Card = Record<string, any>

const SESSION = {
  email: 'member@example.com',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: () => Date.now() + 3_600_000
}

const MEMBER = {
  meMember: {
    user: { username: 'Jane', activeSubscription: true, tier: { name: 'Exandria', planLevel: 2 } }
  }
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

/** Route each GraphQL document to a handler; unknown documents fail loudly. */
function routeCms(routes: Routes): void {
  net.fetch.mockImplementation(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    const handler = routes[body.query]
    if (!handler) throw new Error(`unrouted query: ${String(body.query).slice(0, 40)}`)
    return response({ data: handler(body.variables ?? {}) })
  })
}

function cmsCard(overrides: Card = {}): Card {
  return {
    id: 'e1',
    title: 'Campaign 1 Episode 1',
    slug: 'c1e1',
    duration: 3_300_000,
    contentType: 'video',
    episodeNumber: 1,
    releaseDate: '2024-01-01T00:00:00.000Z',
    contentTier: { name: 'Apprentice', planLevel: 1 },
    primaryCollection: { id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true },
    thumbnail: {
      sizes: {
        landscape: { url: 'https://images.example/landscape/format=auto' },
        landscape2x: { url: 'https://images.example/wide/format=auto' }
      }
    },
    ...overrides
  }
}

function cmsCollection(overrides: Card = {}): Card {
  return {
    id: 's1',
    name: 'Campaign 1',
    slug: 'campaign-1',
    isSeries: true,
    itemCount: 10,
    releaseDate: '2024-01-01T00:00:00.000Z',
    thumbnail: {
      sizes: {
        landscape: { url: 'https://images.example/collection/format=auto' },
        landscape2x: { url: 'https://images.example/collection-wide/format=auto' },
        portrait: { url: 'https://images.example/portrait/format=auto' }
      }
    },
    ...overrides
  }
}

function blockContent(overrides: Card = {}): Record<string, any> {
  return { __typename: 'Content', ...cmsCard(overrides) }
}

function blockCollection(overrides: Card = {}): Record<string, any> {
  return { __typename: 'Collection', ...cmsCollection(overrides) }
}

function indexedVideo(n: number, overrides: Partial<IndexedVideo> = {}): IndexedVideo {
  return {
    id: `e${n}`,
    slug: `c1e${n}`,
    title: `Campaign 1 Episode ${n}`,
    duration: 3_300_000,
    type: 'video',
    tier: 'Apprentice',
    level: 1,
    image: 'https://images.example/landscape/format=auto',
    image2x: 'https://images.example/wide/format=auto',
    released: '2024-01-01T00:00:00.000Z',
    episode: n,
    series: { id: 's1', name: 'Campaign 1', slug: 'campaign-1', isSeries: true },
    ...overrides
  }
}

function indexedCollection(overrides: Partial<IndexedCollection> = {}): IndexedCollection {
  return {
    id: 's1',
    slug: 'campaign-1',
    name: 'Campaign 1',
    isSeries: true,
    itemCount: 1,
    released: null,
    image: null,
    image2x: null,
    portrait: null,
    ...overrides
  }
}

function fakeCatalog(
  options: {
    videos?: IndexedVideo[]
    collections?: IndexedCollection[]
    suggestions?: string[]
  } = {}
): CatalogLike {
  const videos = options.videos ?? []
  const collections = options.collections ?? []
  return {
    ensure: async () => undefined,
    refresh: async () => undefined,
    videoBySlug: (slug) => videos.find((video) => video.slug === slug) ?? null,
    collectionBySlug: (slug) => collections.find((collection) => collection.slug === slug) ?? null,
    videoById: (id) => videos.find((video) => video.id === id) ?? null,
    collectionById: (id) => collections.find((collection) => collection.id === id) ?? null,
    seriesVideos: () => videos,
    localSearch: () => ({ collections: options.collections ?? [], videos }),
    suggest: () => options.suggestions ?? []
  }
}

function cmsCallsTo(query: string): number {
  return net.fetch.mock.calls.filter((call) => {
    const body = (call[1] as { body?: string } | undefined)?.body
    return body ? (JSON.parse(body) as { query?: string }).query === query : false
  }).length
}

function homeRoutes(overrides: Routes = {}): Routes {
  return {
    [Q.ME]: () => MEMBER,
    [Q.CONTINUE_WATCHING]: () => ({ continueWatching: { docs: [] } }),
    [Q.HOME_BLOCKS]: () => ({
      MemberHomePage: {
        pageContent: [{ __typename: 'ContinueWatchingV2', id: 'cw-block', limit: 5 }]
      }
    }),
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(loadSession).mockResolvedValue({ ...SESSION, expiresAt: SESSION.expiresAt() })
  vi.mocked(saveSession).mockResolvedValue()
  net.fetch.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('auth', () => {
  it('signs in with a password grant and reports the account', async () => {
    net.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth/token')) {
        return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 7200 })
      }
      return response({ data: MEMBER })
    })
    const client = new BeaconClient()

    const status = await client.signIn(' member@example.com ', 'hunter2')

    const [authUrl, authInit] = net.fetch.mock.calls[0] as [
      string,
      { body?: string; headers?: Record<string, string>; signal?: AbortSignal }
    ]
    expect(authUrl).toBe('https://pocketbeacon.memberful.com/oauth/token')
    expect(authUrl).not.toContain('hunter2')
    expect(authInit.headers?.['content-type']).toBe('application/x-www-form-urlencoded')
    expect(authInit.signal).toBeInstanceOf(AbortSignal)
    const form = new URLSearchParams(authInit.body)
    expect(form.get('grant_type')).toBe('password')
    expect(form.get('username')).toBe('member@example.com')
    expect(form.get('password')).toBe('hunter2')
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'member@example.com',
        accessToken: 'access-2',
        refreshToken: 'refresh-2'
      })
    )
    expect(status).toEqual({
      signedIn: true,
      user: { name: 'Jane', tier: 'Exandria', active: true }
    })
  })

  it('reports a refused password grant without touching the saved session', async () => {
    net.fetch.mockImplementation(async (url: string) =>
      String(url).includes('oauth/token')
        ? response({ error: 'invalid_grant', error_description: 'Wrong password.' }, 400)
        : response({ data: MEMBER })
    )
    const client = new BeaconClient()

    await expect(client.signIn('member@example.com', 'wrong')).rejects.toThrow('Wrong password.')

    expect(saveSession).not.toHaveBeenCalled()
    await expect(client.isSignedIn()).resolves.toBe(true)
  })

  it('clears the session on sign out', async () => {
    const client = new BeaconClient()

    await client.signOut()

    expect(saveSession).toHaveBeenCalledWith(null)
    await expect(client.isSignedIn()).resolves.toBe(false)
  })

  it('reports a signed-out account without calling the API', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const client = new BeaconClient()

    await expect(client.status()).resolves.toEqual({ signedIn: false, user: null })
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('drops the session when the API rejects the token', async () => {
    let cmsCalls = 0
    net.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth/token')) {
        return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 })
      }
      cmsCalls++
      return response({}, 401)
    })
    const client = new BeaconClient()

    await expect(client.status()).resolves.toEqual({ signedIn: false, user: null })
    expect(cmsCalls).toBe(2)
    expect(saveSession).toHaveBeenCalledWith(null)
  })

  it('keeps the cached identity when the network is down', async () => {
    net.fetch.mockRejectedValue(new Error('offline'))
    const client = new BeaconClient()

    await expect(client.status()).resolves.toEqual({
      signedIn: true,
      user: { name: 'member@example.com', tier: null, active: true }
    })
  })

  it.each([400, 401])(
    'drops the session when the refresh token is rejected with HTTP %i',
    async (httpStatus) => {
      net.fetch.mockImplementation(async (url: string) =>
        String(url).includes('oauth/token')
          ? response({ error: 'invalid_grant' }, httpStatus)
          : response({}, 401)
      )
      const client = new BeaconClient()

      await expect(client.status()).resolves.toEqual({ signedIn: false, user: null })
      expect(saveSession).toHaveBeenCalledWith(null)
    }
  )

  it('keeps the session when the token endpoint itself is down', async () => {
    net.fetch.mockImplementation(async (url: string) =>
      String(url).includes('oauth/token') ? response({}, 500) : response({}, 401)
    )
    const client = new BeaconClient()

    await expect(client.status()).resolves.toEqual({
      signedIn: true,
      user: { name: 'member@example.com', tier: null, active: true }
    })
    expect(saveSession).not.toHaveBeenCalledWith(null)
  })
})

describe('home', () => {
  it('renders the shelves in the order the home document gives', async () => {
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: {
            docs: [
              { videoProgress: 40, content: cmsCard({ id: 'cw1', slug: 'cw1', title: 'Started' }) },
              { videoProgress: 96, content: cmsCard({ id: 'cw2', slug: 'cw2', title: 'Finished' }) }
            ]
          }
        }),
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'RedesignHeroCarousel',
                id: 'hero-block',
                items: [
                  {
                    item: {
                      value: blockCollection({
                        id: 'hc',
                        slug: 'hero-collection',
                        name: 'Hero Collection'
                      })
                    }
                  }
                ]
              },
              {
                __typename: 'FeaturedCarousel',
                id: 'featured-block',
                title: 'Featured',
                content: [
                  blockContent({
                    id: 'f1',
                    slug: 'featured-1',
                    title: 'Featured One',
                    duration: 3_000_000
                  }),
                  blockContent({ id: 'art', slug: 'article', contentType: 'editorial' })
                ]
              },
              { __typename: 'ContinueWatchingV2', id: 'cw-block', limit: 5 },
              {
                __typename: 'SeriesCarousel',
                id: 'series-block',
                title: 'Watch by Series',
                content: [blockCollection({ id: 's1', slug: 'campaign-1', name: 'Campaign 1' })]
              },
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [blockContent({ id: 'l1', slug: 'latest-1' })]
              },
              { __typename: 'ReadCarousel', id: 'read-block' }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows.map((row) => [row.id, row.kind, row.title])).toEqual([
      ['featured-block', 'featured', 'Featured'],
      ['cw-block', 'continue', 'Continue watching'],
      ['series-block', 'series', 'Watch by Series'],
      ['latest-block', 'latest', 'Latest Videos']
    ])
    expect(home.rows[0].items.map((item) => item.slug)).toEqual(['featured-1'])
    expect(home.rows[0].items[0].minutes).toBe(50)
    expect(home.rows[1].items.map((item) => item.slug)).toEqual(['cw1'])
    expect(home.rows[1].items[0].progress).toBe(0.4)
    expect(home.rows[2].items[0]).toMatchObject({ kind: 'series', count: 10 })
    expect(home.hero.map((card) => card.slug)).toEqual(['hero-collection'])
    expect(home.hero[0].image).toBe('https://images.example/collection/format=auto,width=1280')
  })

  it('shows ottTitle on tiles, falling back to the full title', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [
                  blockContent({
                    id: 'l1',
                    slug: 'short',
                    title: 'C4 E043 | The Water’s Edge',
                    ottTitle: 'The Water’s Edge'
                  }),
                  blockContent({ id: 'l2', slug: 'full', title: 'Only Title' })
                ]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows[0].items.map((item) => item.title)).toEqual(['The Water’s Edge', 'Only Title'])
  })

  it('drops a block excluded for the platform we identify as', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'FeaturedCarousel',
                id: 'featured-block',
                title: 'Featured',
                excludedPlatforms: { ios: false, android: false, web: true },
                content: [blockContent({ slug: 'web-hidden' })]
              },
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                excludedPlatforms: { ios: false, android: false, web: false },
                content: [blockContent({ slug: 'kept' })]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows.map((row) => row.id)).toEqual(['latest-block'])
    expect(home.rows[0].items.map((item) => item.slug)).toEqual(['kept'])
  })

  it('takes the Continue watching limit from its block', async () => {
    const docs = Array.from({ length: 8 }, (_, index) => ({
      videoProgress: 40,
      content: cmsCard({ id: `cw${index}`, slug: `cw${index}` })
    }))
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({ continueWatching: { docs } }),
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [{ __typename: 'ContinueWatchingV2', id: 'cw-block', limit: 3 }]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows[0].items).toHaveLength(3)
  })

  it('fills the Continue watching limit with unfinished entries, not finished ones', async () => {
    const docs = [
      { videoProgress: 99, content: cmsCard({ id: 'done1', slug: 'done1' }) },
      { videoProgress: 95, content: cmsCard({ id: 'done2', slug: 'done2' }) },
      { videoProgress: 40, content: cmsCard({ id: 'cw1', slug: 'cw1' }) },
      { videoProgress: 30, content: cmsCard({ id: 'cw2', slug: 'cw2' }) },
      { videoProgress: 20, content: cmsCard({ id: 'cw3', slug: 'cw3' }) }
    ]
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({ continueWatching: { docs } }),
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [{ __typename: 'ContinueWatchingV2', id: 'cw-block', limit: 3 }]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows[0].items.map((item) => item.slug)).toEqual(['cw1', 'cw2', 'cw3'])
  })

  it('omits finished rows and empty sections', async () => {
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: {
            docs: [{ videoProgress: 99, content: cmsCard({ id: 'cw1', slug: 'cw1' }) }]
          }
        })
      })
    )
    const client = new BeaconClient()

    await expect(client.home()).resolves.toEqual({ hero: [], rows: [] })
  })

  it('hides an episode watched past 92%, though the player would still resume it', async () => {
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: {
            docs: [{ videoProgress: 93, content: cmsCard({ id: 'cw1', slug: 'cw1' }) }]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows.find((row) => row.kind === 'continue')).toBeUndefined()
  })

  it('measures the tail in time, so a long episode stays in the row', async () => {
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: {
            docs: [
              // Four hours, 94% watched: 14:24 still to play.
              {
                videoProgress: 94,
                videoProgressSeconds: 13_536,
                content: cmsCard({ id: 'long', slug: 'long', duration: 14_400_000 })
              },
              // The same runtime at 99.9%: 14 seconds left, so it is done.
              {
                videoProgress: 99.9,
                videoProgressSeconds: 14_386,
                content: cmsCard({ id: 'done', slug: 'done', duration: 14_400_000 })
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows[0].items.map((item) => item.slug)).toEqual(['long'])
  })

  it('skips the continue-watching query when signed out', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    routeCms(homeRoutes())
    const client = new BeaconClient()

    await client.home()

    expect(cmsCallsTo(Q.HOME_BLOCKS)).toBe(1)
    expect(cmsCallsTo(Q.CONTINUE_WATCHING)).toBe(0)
  })

  it('locks items above the account tier', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [
                  blockContent({ slug: 'free', contentTier: { name: 'Apprentice', planLevel: 1 } }),
                  blockContent({ slug: 'paid', contentTier: { name: 'Exandria', planLevel: 3 } })
                ]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows[0].items.map((item) => [item.slug, item.locked])).toEqual([
      ['free', false],
      ['paid', true]
    ])
  })

  it('caps the hero block at eight and asks for hero-size art', async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      item: {
        value: blockCollection({ id: `hc${index}`, slug: `hero-${index}`, name: `Hero ${index}` })
      }
    }))
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [{ __typename: 'RedesignHeroCarousel', id: 'hero-block', items }]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.hero).toHaveLength(8)
    expect(home.hero[0].image).toBe('https://images.example/collection/format=auto,width=1280')
    expect(home.hero[0].image2x).toBe(
      'https://images.example/collection-wide/format=auto,width=1280'
    )
  })

  it('falls back to the first video shelf for the hero', async () => {
    const content = Array.from({ length: 7 }, (_, index) =>
      blockContent({ id: `l${index}`, slug: `latest-${index}` })
    )
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              { __typename: 'LatestCarousel', id: 'latest-block', title: 'Latest Videos', content }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.hero.map((card) => card.slug)).toEqual([
      'latest-0',
      'latest-1',
      'latest-2',
      'latest-3',
      'latest-4'
    ])
    expect(home.hero[0].image).toBe('https://images.example/landscape/format=auto,width=1280')
  })

  it('ignores block kinds it has no fragment for', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              { __typename: 'ReadCarousel', id: 'read-block' },
              { __typename: 'ListenCarousel', id: 'listen-block' }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    await expect(client.home()).resolves.toEqual({ hero: [], rows: [] })
  })
})

describe('content', () => {
  const videos = Array.from({ length: 8 }, (_, index) => indexedVideo(index + 1))

  function contentRoutes(doc: Card, overrides: Routes = {}): Routes {
    return {
      [Q.ME]: () => MEMBER,
      [Q.CONTENT]: () => ({
        Contents: { docs: [doc] },
        currentProgress: { videoProgress: 40, videoProgressSeconds: 125 }
      }),
      [Q.SERIES]: (variables) =>
        variables.content
          ? { fetchSeries: { next: cmsCard({ id: 'e6', slug: 'c1e6', episodeNumber: 6 }) } }
          : { fetchSeries: {} },
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e6', videoProgress: 50 }] }
      }),
      ...overrides
    }
  }

  function playableDoc(overrides: Card = {}): Card {
    return cmsCard({
      id: 'e5',
      slug: 'c1e5',
      episodeNumber: 5,
      description: 'An episode.',
      continuedSummary: 'The rest of the page body.',
      contentVideo: { video: { video: 'https://cdn.jwplayer.com/manifests/abc.m3u8' } },
      content: [{ carouselContent: [cmsCard({ id: 'rec1', slug: 'rec1', title: 'Recommended' })] }],
      ...overrides
    })
  }

  it('returns the details of a video', async () => {
    routeCms(contentRoutes(playableDoc()))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content).toMatchObject({
      id: 'e5',
      slug: 'c1e5',
      title: 'Campaign 1 Episode 1',
      description: 'An episode.',
      continuedSummary: 'The rest of the page body.',
      minutes: 55,
      released: '2024-01-01T00:00:00.000Z',
      series: { slug: 'campaign-1', title: 'Campaign 1', isSeries: true },
      tier: 'Apprentice',
      locked: false,
      signInNeeded: false,
      resumeAt: 125
    })
  })

  it('falls back to a filed collection when there is no primary one', async () => {
    routeCms(
      contentRoutes(
        playableDoc({
          primaryCollection: null,
          collections: [
            { id: 'p1', name: 'Previously On...', slug: 'previously-on', isSeries: false }
          ]
        })
      )
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.series).toEqual({
      slug: 'previously-on',
      title: 'Previously On...',
      isSeries: false
    })
  })

  it('lists the next episode, more from the series and recommendations', async () => {
    routeCms(contentRoutes(playableDoc()))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.rows.map((row) => row.title)).toEqual([
      'Next episode',
      'More from Campaign 1',
      'Recommended'
    ])
    expect(content.rows[0].items[0].progress).toBe(0.5)
    expect(content.rows[1].items.map((item) => item.slug)).toEqual(['c1e6', 'c1e7', 'c1e8'])
  })

  it('adds other versions of the same episode', async () => {
    const versions = [
      ...videos,
      indexedVideo(5, { id: 'e5b', slug: 'c1e5-reaction', title: 'Campaign 1 Episode 5 Reaction' })
    ]
    routeCms(contentRoutes(playableDoc()))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: versions })

    const content = (await client.content('c1e5'))!

    expect(content.rows.map((row) => row.title)).toEqual([
      'Next episode',
      'Other versions',
      'More from Campaign 1',
      'Recommended'
    ])
    expect(content.rows[1].items.map((item) => item.slug)).toEqual(['c1e5-reaction'])
  })

  it('suggests the last episodes when the current one ends the series', async () => {
    routeCms(
      contentRoutes(playableDoc({ id: 'e8', slug: 'c1e8', episodeNumber: 8, content: [] }), {
        [Q.SERIES]: () => ({ fetchSeries: {} })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e8'))!

    expect(content.rows.map((row) => row.title)).toEqual(['More from Campaign 1'])
    expect(content.rows[0].items.map((item) => item.slug)).toEqual([
      'c1e7',
      'c1e6',
      'c1e5',
      'c1e4',
      'c1e3',
      'c1e2',
      'c1e1'
    ])
  })

  it('marks a video that needs a higher tier or a sign-in', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    routeCms(contentRoutes(playableDoc({ contentVideo: null })))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.locked).toBe(true)
    expect(content.signInNeeded).toBe(true)
  })

  it('ignores a resume point near the end', async () => {
    routeCms(
      contentRoutes(playableDoc(), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc()] },
          // 96% of the 55-minute runtime: only 2:12 of credits remain.
          currentProgress: { videoProgress: 96, videoProgressSeconds: 3168 }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.resumeAt).toBe(0)
  })

  it('resumes a video watched past the home-screen cutoff', async () => {
    // 94% is past the 92% point where Home stops listing an episode.
    routeCms(
      contentRoutes(playableDoc(), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc()] },
          currentProgress: { videoProgress: 94, videoProgressSeconds: 3102 }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.resumeAt).toBe(3102)
  })

  it('resumes a long episode whose closing stretch is still minutes away', async () => {
    // 96% of a four-hour episode leaves 9:36 to play, so it is not an ending.
    routeCms(
      contentRoutes(playableDoc({ duration: 14_400_000 }), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc({ duration: 14_400_000 })] },
          currentProgress: { videoProgress: 96, videoProgressSeconds: 13_824 }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.resumeAt).toBe(13_824)
  })

  it('does not offer to resume the first few seconds', async () => {
    routeCms(
      contentRoutes(playableDoc(), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc()] },
          // One second is the position used to clear a finished episode.
          currentProgress: { videoProgress: 0, videoProgressSeconds: 1 }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    expect(content.watched).toBe(false)
    expect(content.resumeAt).toBe(0)
  })

  it('shows the same watched state on the page as the tiles', async () => {
    routeCms(
      contentRoutes(playableDoc(), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc()] },
          // The page's own read still lags the per-id read the tiles use.
          currentProgress: { videoProgress: 40, videoProgressSeconds: 125 }
        }),
        [Q.PROGRESS_FOR]: () => ({
          getProgressForContent: {
            timeMap: [{ contentId: 'e5', videoProgress: 99, videoProgressSeconds: 3267 }]
          }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = (await client.content('c1e5'))!

    // The list badge is watched, so the page must offer to unmark it, not mark
    // it again, and must not offer to resume an almost-finished episode.
    expect(content.watched).toBe(true)
    expect(content.resumeAt).toBe(0)
  })

  it('shows a marked episode as watched and drops its resume point', async () => {
    let marked = false
    routeCms(
      contentRoutes(playableDoc(), {
        [Q.CONTENT]: () => ({
          Contents: { docs: [playableDoc()] },
          currentProgress: marked
            ? { videoProgress: 100, videoProgressSeconds: 3300 }
            : { videoProgress: 10, videoProgressSeconds: 300 }
        }),
        [Q.TRACK]: () => {
          marked = true
          return { trackView: { success: true } }
        },
        [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
          removeContentFromContinueWatching: { success: true }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const before = (await client.content('c1e5'))!
    expect(before.watched).toBe(false)
    expect(before.resumeAt).toBe(300)

    await client.markWatched('c1e5', true)

    const after = (await client.content('c1e5'))!
    expect(after.watched).toBe(true)
    expect(after.resumeAt).toBe(0)
  })
})

describe('play', () => {
  it('reads captions from the playlist data', async () => {
    routeCms({
      [Q.MEDIA]: () => ({
        Contents: {
          docs: [
            {
              id: 'e1',
              title: 'Episode 1',
              duration: 3_600_000,
              contentVideo: {
                video: {
                  video: 'https://cdn.jwplayer.com/manifests/abc.m3u8',
                  videoData: JSON.stringify({
                    playlist: [
                      {
                        tracks: [
                          {
                            kind: 'captions',
                            label: 'English',
                            file: 'https://cdn.example/en.vtt'
                          },
                          { kind: 'subtitles', file: 'https://cdn.example/fr.vtt' },
                          { kind: 'thumbnails', file: 'https://cdn.example/thumbs.vtt' },
                          { kind: 'captions' }
                        ]
                      }
                    ]
                  }),
                  closedCaptions: 'https://cdn.example/fallback.vtt'
                }
              }
            }
          ]
        },
        currentProgress: { videoProgress: 10, videoProgressSeconds: 30 }
      })
    })
    const client = new BeaconClient()

    const playback = await client.play('c1e1')

    expect(playback).toEqual({
      id: 'e1',
      title: 'Episode 1',
      url: 'https://cdn.jwplayer.com/manifests/abc.m3u8',
      playlist: null,
      duration: 3600,
      resumeAt: 30,
      captions: [
        { label: 'English', url: 'https://cdn.example/en.vtt' },
        { label: 'Subtitles', url: 'https://cdn.example/fr.vtt' }
      ],
      episodeNumber: null,
      collection: null
    })
  })

  it('falls back to the closed-captions URL', async () => {
    routeCms({
      [Q.MEDIA]: () => ({
        Contents: {
          docs: [
            {
              id: 'e1',
              contentVideo: {
                video: {
                  video: 'https://cdn.jwplayer.com/manifests/abc.m3u8',
                  videoData: 'not json',
                  closedCaptions: 'https://cdn.example/fallback.vtt'
                }
              }
            }
          ]
        }
      })
    })
    const client = new BeaconClient()

    const playback = await client.play('c1e1')

    expect(playback?.captions).toEqual([
      { label: 'Subtitles', url: 'https://cdn.example/fallback.vtt' }
    ])
  })

  it('ignores a closed-captions value that is not a URL', async () => {
    routeCms({
      [Q.MEDIA]: () => ({
        Contents: {
          docs: [
            {
              id: 'e1',
              contentVideo: {
                video: {
                  video: 'https://cdn.jwplayer.com/manifests/abc.m3u8',
                  closedCaptions: 'captions/en.vtt'
                }
              }
            }
          ]
        }
      })
    })
    const client = new BeaconClient()

    await expect(client.play('c1e1')).resolves.toMatchObject({ captions: [] })
  })

  it('returns null when there is no video', async () => {
    routeCms({ [Q.MEDIA]: () => ({ Contents: { docs: [] } }) })
    const client = new BeaconClient()

    await expect(client.play('c1e1')).resolves.toBeNull()
  })
})

describe('nextEpisode', () => {
  function routes(next: Card | null, autoplayDisabled = false) {
    return {
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { next, autoplayDisabled } })
    }
  }

  const request = {
    contentId: 'e5',
    collectionId: 's1',
    isSeries: true
  }

  it('offers the next episode of the series', async () => {
    routeCms(
      routes(cmsCard({ id: 'e6', slug: 'c1e6', title: 'Campaign 1 Episode 6', episodeNumber: 6 }))
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toEqual({
      slug: 'c1e6',
      title: 'Campaign 1 Episode 6',
      image: 'https://images.example/landscape/format=auto,width=480',
      minutes: 55,
      autoplayDisabled: false
    })
  })

  it('shows ottTitle on the next-episode card', async () => {
    routeCms(
      routes(
        cmsCard({
          id: 'e6',
          slug: 'c1e6',
          title: 'C4 E006 | A Long Full Title',
          ottTitle: 'A Long Full Title',
          episodeNumber: 6
        })
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toMatchObject({
      title: 'A Long Full Title'
    })
  })

  it('reports a series whose editor disabled autoplay', async () => {
    routeCms(
      routes(
        cmsCard({ id: 'e6', slug: 'c1e6', title: 'Campaign 1 Episode 6', episodeNumber: 6 }),
        true
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toEqual({
      slug: 'c1e6',
      title: 'Campaign 1 Episode 6',
      image: 'https://images.example/landscape/format=auto,width=480',
      minutes: 55,
      autoplayDisabled: true
    })
  })

  it('asks nothing for a video in a collection folder', async () => {
    routeCms({})
    const client = new BeaconClient()

    await expect(client.nextEpisode({ ...request, isSeries: false })).resolves.toBeNull()
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('offers a locked next episode, like Beacon', async () => {
    routeCms(
      routes(
        cmsCard({
          id: 'e6',
          slug: 'c1e6',
          title: 'Campaign 1 Episode 6',
          episodeNumber: 6,
          contentTier: { name: 'Exandria', planLevel: 3 }
        })
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toEqual({
      slug: 'c1e6',
      title: 'Campaign 1 Episode 6',
      image: 'https://images.example/landscape/format=auto,width=480',
      minutes: 55,
      autoplayDisabled: false
    })
  })

  it('trusts the pointer when the numbering restarts', async () => {
    // Kymal E2 -> Calamity E1: the app offers it, so we do too.
    routeCms(
      routes(
        cmsCard({
          id: 'calamity-e1',
          slug: 'calamity-e1',
          title: 'Calamity E1',
          episodeNumber: 1
        })
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toMatchObject({ slug: 'calamity-e1' })
  })

  it('offers a next episode from another collection', async () => {
    routeCms(
      routes(
        cmsCard({
          id: 'c2e1',
          slug: 'c2e1',
          title: 'Another Show E1',
          episodeNumber: 1,
          primaryCollection: {
            id: 'c2',
            name: 'Another Show',
            slug: 'another-show',
            isSeries: true
          }
        })
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toMatchObject({ slug: 'c2e1' })
  })

  it('returns null when the pointer has no next item', async () => {
    routeCms(routes(null))
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toBeNull()
  })

  it('returns null when Beacon cannot answer', async () => {
    routeCms({ [Q.ME]: () => MEMBER })
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toBeNull()
  })
})

describe('trackProgress', () => {
  it('reports the rounded position and percentage', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    const ok = await client.trackProgress('e1', 300.4, 600)
    expect(ok).toBe(true)
    expect(event).toBeNull()

    await client.flushProgress()

    expect(event).toMatchObject({
      content: 'e1',
      duration: 600,
      videoProgressSeconds: 300,
      videoProgress: 50
    })
    expect(event!.sessionId).toMatch(/^linux-/)
    expect(event!.viewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('clamps the percentage at 100', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await client.trackProgress('e1', 900, 600)
    await client.flushProgress()

    expect(event!.videoProgress).toBe(100)
  })

  it('reports 0 progress without a duration', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await client.trackProgress('e1', 10, 0)
    await client.flushProgress()

    expect(event!.videoProgress).toBe(0)
    expect(event!.duration).toBe(0)
  })

  it('never rounds a started video down to 0%', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    // 40 seconds into a four-hour episode.
    await client.trackProgress('e1', 40, 4 * 3600)
    await client.flushProgress()

    expect(event!.videoProgressSeconds).toBe(40)
    expect(event!.videoProgress).toBe(1)
  })

  it('queues one position per ten-second bucket, keeping the first', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await client.trackProgress('e1', 12, 600)
    await client.trackProgress('e1', 18, 600)
    await client.trackProgress('e1', 21, 600)
    await client.flushProgress()

    expect(events.map((event) => event.videoProgressSeconds)).toEqual([12, 21])
  })

  it('sends ten events per mutation and drains the rest', async () => {
    const batches: number[] = []
    routeCms({
      [Q.TRACK]: (variables) => {
        batches.push(variables.events.length)
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    for (let step = 1; step <= 9; step++) {
      await client.trackProgress('e1', step * 10, 600)
    }
    expect(batches).toEqual([])

    // The tenth event is what makes the app flush before the timer.
    await client.trackProgress('e1', 100, 600)
    await vi.waitFor(() => expect(batches).toEqual([10]))

    await client.trackProgress('e1', 110, 600)
    await client.trackProgress('e1', 120, 600)
    await expect(client.flushProgress()).resolves.toBe(true)
    expect(batches).toEqual([10, 2])
  })

  it('flushes queued positions on the twenty-second timer', async () => {
    vi.useFakeTimers()
    const batches: number[] = []
    routeCms({
      [Q.TRACK]: (variables) => {
        batches.push(variables.events.length)
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await client.trackProgress('e1', 10, 600)
    await client.trackProgress('e1', 20, 600)
    await vi.advanceTimersByTimeAsync(19_000)
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(batches).toEqual([2])
  })

  it('recovers a failed batch one event at a time', async () => {
    const batches: number[] = []
    let attempts = 0
    routeCms({
      [Q.TRACK]: (variables) => {
        attempts += 1
        if (attempts === 1) throw new Error('Beacon is busy')
        batches.push(variables.events.length)
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await client.trackProgress('e1', 10, 600)
    await client.trackProgress('e1', 20, 600)

    // The batch is refused once, then its events go on their own, so a blip
    // costs no positions and nothing stays blocked behind them.
    await expect(client.flushProgress()).resolves.toBe(true)
    expect(batches).toEqual([1, 1])
  })

  it('sends a started view on its own, before any position', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      }
    })
    const client = new BeaconClient()

    await expect(client.trackStart('e1')).resolves.toBe(true)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ content: 'e1' })
    expect(events[0]).not.toHaveProperty('duration')
    expect(events[0]).not.toHaveProperty('videoProgress')
    expect(events[0]).not.toHaveProperty('videoProgressSeconds')
  })

  it('does nothing when signed out', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const client = new BeaconClient()

    await expect(client.trackProgress('e1', 10, 100)).resolves.toBe(false)
    await expect(client.trackStart('e1')).resolves.toBe(false)
    await expect(client.flushProgress()).resolves.toBe(false)
    expect(net.fetch).not.toHaveBeenCalled()
  })
})

describe('watch state', () => {
  it('badges a finished episode in a collection', async () => {
    const collection: IndexedCollection = {
      id: 's1',
      slug: 'campaign-1',
      name: 'Campaign 1',
      isSeries: true,
      itemCount: 2,
      released: null,
      image: null,
      image2x: null,
      portrait: null
    }
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({
        fetchSeries: {
          docs: [
            { content: cmsCard({ id: 'e1', slug: 'c1e1', duration: 3_300_000 }) },
            { content: cmsCard({ id: 'e2', slug: 'c1e2', duration: 3_300_000 }) }
          ]
        }
      }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [
            { contentId: 'e1', videoProgress: 99, videoProgressSeconds: 3267 },
            { contentId: 'e2', videoProgress: 50, videoProgressSeconds: 1650 }
          ]
        }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ collections: [collection] })

    const data = (await client.collection('campaign-1'))!

    expect(data.seasons[0].items[0]).toMatchObject({
      slug: 'c1e1',
      progress: 0.99,
      watched: true
    })
    expect(data.seasons[0].items[1]).toMatchObject({
      slug: 'c1e2',
      progress: 0.5,
      watched: false
    })
  })

  it('keeps a collection page and clears it on sign-out', async () => {
    const collection: IndexedCollection = {
      id: 's1',
      slug: 'campaign-1',
      name: 'Campaign 1',
      isSeries: true,
      itemCount: 1,
      released: null,
      image: null,
      image2x: null,
      portrait: null
    }
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ collections: [collection] })
    const store = {
      readAll: vi.fn(() => ({ collections: [], contents: [] })),
      saveCollection: vi.fn(),
      saveContent: vi.fn(),
      deleteCollection: vi.fn(),
      deleteContent: vi.fn(),
      clear: vi.fn()
    }
    client.pageStore = store as unknown as PageStore

    const data = (await client.collection('campaign-1'))!

    expect(data).not.toBeNull()
    expect(store.saveCollection).toHaveBeenCalledWith('member@example.com', expect.any(Object))
    await client.signOut()
    expect(store.clear).toHaveBeenCalledOnce()
  })

  it('keeps an episode page and clears it on sign-out', async () => {
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.CONTENT]: () => ({
        Contents: {
          docs: [
            cmsCard({
              primaryCollection: {
                id: 'c1',
                name: 'One Shots',
                slug: 'one-shots',
                isSeries: false
              }
            })
          ]
        }
      }),
      [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog()
    const store = {
      readAll: vi.fn(() => ({ collections: [], contents: [] })),
      saveCollection: vi.fn(),
      saveContent: vi.fn(),
      deleteCollection: vi.fn(),
      deleteContent: vi.fn(),
      clear: vi.fn()
    }
    client.pageStore = store as unknown as PageStore

    const data = (await client.content('c1e1'))!

    expect(data).not.toBeNull()
    expect(store.saveContent).toHaveBeenCalledWith('member@example.com', expect.any(Object))
    await client.signOut()
    expect(store.clear).toHaveBeenCalledOnce()
  })

  it('answers null and drops a saved collection the CMS no longer has', async () => {
    const client = new BeaconClient()
    client.catalog = fakeCatalog()
    const store = {
      readAll: vi.fn(() => ({ collections: [], contents: [] })),
      saveCollection: vi.fn(),
      saveContent: vi.fn(),
      deleteCollection: vi.fn(),
      deleteContent: vi.fn(),
      clear: vi.fn()
    }
    client.pageStore = store as unknown as PageStore

    await expect(client.collection('missing')).resolves.toBeNull()
    expect(store.deleteCollection).toHaveBeenCalledWith('member@example.com', 'missing')
    expect(store.saveCollection).not.toHaveBeenCalled()
  })

  it('answers null and drops a saved episode the CMS no longer has', async () => {
    routeCms({ [Q.CONTENT]: () => ({ Contents: { docs: [] } }) })
    const client = new BeaconClient()
    client.catalog = fakeCatalog()
    const store = {
      readAll: vi.fn(() => ({ collections: [], contents: [] })),
      saveCollection: vi.fn(),
      saveContent: vi.fn(),
      deleteCollection: vi.fn(),
      deleteContent: vi.fn(),
      clear: vi.fn()
    }
    client.pageStore = store as unknown as PageStore

    await expect(client.content('missing')).resolves.toBeNull()
    expect(store.deleteContent).toHaveBeenCalledWith('member@example.com', 'missing')
    expect(store.saveContent).not.toHaveBeenCalled()
  })

  it('refreshes the catalog when a block names a collection it has not seen', async () => {
    const collections: IndexedCollection[] = []
    const catalog = fakeCatalog({ collections })
    catalog.refresh = vi.fn(async () => {
      collections.push({
        id: 'new1',
        slug: 'new-series',
        name: 'New Series',
        isSeries: true,
        itemCount: 2,
        released: null,
        image: null,
        image2x: null,
        portrait: null
      })
    })
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [], collection: { series: [] } } }),
      [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } })
    })
    const client = new BeaconClient()
    client.catalog = catalog

    const data = (await client.collection('new-series'))!

    expect(catalog.refresh).toHaveBeenCalledOnce()
    expect(data).toMatchObject({ title: 'New Series', isSeries: true })
  })

  it('marks an episode watched at its full runtime', async () => {
    let event: Record<string, any> | null = null
    let removed = 0
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => {
        removed += 1
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await expect(client.markWatched('c1e1', true)).resolves.toEqual({
      watched: true,
      progress: 1
    })

    // The last second, reported below the CMS's 98% cutoff: 99 is accepted and
    // then discarded, which left the mark on this machine only.
    expect(event).toMatchObject({
      content: 'e1',
      videoProgress: 97,
      videoProgressSeconds: 3299
    })
    // The queue's bookkeeping is ours, not an EventInput field.
    expect(event).not.toHaveProperty('removeFromContinueWatching')
    expect(event).not.toHaveProperty('explicitMark')
    // Removing the row zeroes the point it was told about, so a watched mark
    // must not ask for it.
    expect(removed).toBe(0)
  })

  it('drops a queued position instead of sending it to read a baseline', async () => {
    const batches: Record<string, any>[][] = []
    routeCms({
      [Q.TRACK]: (variables) => {
        batches.push(variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.trackProgress('e1', 120, 3300)
    await client.markWatched('c1e1', true)

    // The baseline read must not flush the queued position just to learn what
    // it is: the mark is newer, so its own point replaces that report.
    expect(cmsCallsTo(Q.PROGRESS_FOR)).toBeGreaterThanOrEqual(1)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]).toMatchObject({
      content: 'e1',
      videoProgress: 97,
      videoProgressSeconds: 3299
    })
  })

  it('records a mark baseline from the server, not a stale cached point', async () => {
    const events: Record<string, any>[] = []
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    // Prime the cache while the account is at 10%.
    await client.progressFor(['e1'])
    // Someone watched elsewhere; the cached point is now stale.
    stored = { videoProgress: 50, videoProgressSeconds: 1650 }
    await client.markWatched('c1e1', true)
    expect(events).toHaveLength(1)

    // The server later reports the point the cache held. A stale baseline would
    // look unchanged and re-send the mark; the fresh 50% marks it as moved.
    stored = { videoProgress: 10, videoProgressSeconds: 300 }
    await client.reconcileMarks()

    expect(events).toHaveLength(1)
  })

  it('records the baseline while an older position report is still in flight', async () => {
    const batches: Record<string, any>[][] = []
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reportInFlight = false
    let baselineReadWhileInFlight = false
    routeCms({
      [Q.PROGRESS_FOR]: () => {
        if (reportInFlight) baselineReadWhileInFlight = true
        return { getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] } }
      },
      [Q.TRACK]: async (variables) => {
        if (!reportInFlight) {
          reportInFlight = true
          await gate
        }
        batches.push(variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    // A cached point from before the watch elsewhere.
    await client.progressFor(['e1'])
    stored = { videoProgress: 50, videoProgressSeconds: 1650 }

    await client.trackProgress('e1', 120, 3300)
    const flushing = client.flushProgress()
    await vi.waitFor(() => expect(reportInFlight).toBe(true))

    // The baseline read must not settle the queue first: that would wait out
    // the report (or time out) before the mark could even be recorded.
    const marking = client.markWatched('c1e1', true)
    await vi.waitFor(() => expect(baselineReadWhileInFlight).toBe(true))

    release()
    await flushing
    await marking

    // The report was already on the wire, so it lands first; the mark follows
    // it and must not be overtaken by an older point.
    expect(batches.map((batch) => batch[0]!.videoProgress)).toEqual([4, 97])

    // The fresh 50% baseline makes the server's later 10% look like a watch
    // elsewhere, so the mark is dropped rather than re-sent.
    stored = { videoProgress: 10, videoProgressSeconds: 300 }
    const sent = batches.length
    await client.reconcileMarks()
    expect(batches).toHaveLength(sent)
  })

  it('keeps a mark queued when Beacon cannot take it, then sends it later', async () => {
    const events: Record<string, any>[] = []
    let removed = 0
    let attempts = 0
    routeCms({
      [Q.TRACK]: (variables) => {
        attempts += 1
        if (attempts === 1) throw new Error('Beacon is busy')
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => {
        removed += 1
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await expect(client.markWatched('c1e1', true)).resolves.toEqual({
      watched: true,
      progress: 1
    })
    expect(removed).toBe(0)

    await expect(client.flushProgress()).resolves.toBe(true)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      content: 'e1',
      videoProgress: 97,
      videoProgressSeconds: 3299
    })
    expect(removed).toBe(0)
  })

  it('sends a mark again when Beacon never confirmed it', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 10, videoProgressSeconds: 300 }]
        }
      }),
      [Q.TRACK]: (variables) => {
        // Accepted, then dropped, as the CMS does with a point it dislikes.
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    await client.reconcileMarks()

    // Both attempts carry the same point: this is one lost write tried again,
    // not a second, different decision.
    expect(
      events.map((event) => [event.content, event.videoProgress, event.videoProgressSeconds])
    ).toEqual([
      ['e1', 97, 3299],
      ['e1', 97, 3299]
    ])
  })

  it('drops a mark Beacon already agrees with instead of sending it again', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 97, videoProgressSeconds: 3299 }]
        }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    await client.reconcileMarks()

    // "No second send" would also pass if reconcile never ran, so pin that it
    // read the account: the mark's own read, then the reconcile's.
    expect(cmsCallsTo(Q.PROGRESS_FOR)).toBeGreaterThanOrEqual(2)
    expect(events).toHaveLength(1)
  })

  it('does not re-send a mark when the progress read fails', async () => {
    const events: Record<string, any>[] = []
    let readFails = false
    routeCms({
      [Q.PROGRESS_FOR]: () => {
        if (readFails) throw new Error('offline')
        return {
          getProgressForContent: {
            timeMap: [{ contentId: 'e1', videoProgress: 10, videoProgressSeconds: 300 }]
          }
        }
      },
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    // The mark does get a recorded point, so only the failed read stands
    // between it and a retry.
    await client.markWatched('c1e1', true)
    readFails = true
    await client.reconcileMarks()

    expect(cmsCallsTo(Q.PROGRESS_FOR)).toBe(2)
    expect(events).toHaveLength(1)
  })

  it('stops re-sending a mark Beacon will not take', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 10, videoProgressSeconds: 300 }]
        }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    const sendsPerLaunch: number[] = []
    for (let launch = 0; launch < MARK_RETRIES + 2; launch++) {
      await client.reconcileMarks()
      sendsPerLaunch.push(events.length)
    }

    expect(sendsPerLaunch.at(-2)).toBe(1 + MARK_RETRIES)
    // The important part is that it stops growing, not the exact number.
    expect(sendsPerLaunch.at(-1)).toBe(sendsPerLaunch.at(-2))
  })

  it('does not spend mark retries on launches that never reached Beacon', async () => {
    let online = false
    let attempts = 0
    const landed: Record<string, any>[] = []
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 10, videoProgressSeconds: 300 }]
        }
      }),
      [Q.TRACK]: (variables) => {
        attempts += 1
        if (!online) throw new Error('offline')
        landed.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    // The first mark and four launches all fail before Beacon sees them.
    await client.markWatched('c1e1', true)
    for (let launch = 0; launch < MARK_RETRIES + 1; launch++) await client.reconcileMarks()
    expect(landed).toHaveLength(0)

    // The budget is untouched, so every retry still goes out.
    online = true
    for (let retry = 0; retry < MARK_RETRIES; retry++) await client.reconcileMarks()
    expect(landed).toHaveLength(MARK_RETRIES)

    const attemptsAtCap = attempts
    await client.reconcileMarks()
    expect(attempts).toBe(attemptsAtCap)
  })

  it('still checks a capped mark for a server that agrees or moved', async () => {
    const events: Record<string, any>[] = []
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1)],
      collections: [indexedCollection()]
    })

    await client.markWatched('c1e1', true)
    for (let launch = 0; launch < MARK_RETRIES; launch++) await client.reconcileMarks()
    const capped = events.length

    // The server moved on, but the mark has no retries left. It still has to be
    // read and dropped, or it would keep masking the newer point forever.
    stored = { videoProgress: 40, videoProgressSeconds: 1320 }
    await client.reconcileMarks()
    expect(events).toHaveLength(capped)

    const data = (await client.collection('campaign-1'))!
    expect(data.seasons[0].items[0]).toMatchObject({ progress: 0.4, watched: false })
  })

  it('lets a fresh mark start its retries over', async () => {
    const events: Record<string, any>[] = []
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 10, videoProgressSeconds: 300 }]
        }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    for (let launch = 0; launch < MARK_RETRIES + 2; launch++) await client.reconcileMarks()
    const exhausted = events.length
    await client.reconcileMarks()
    expect(events.length).toBe(exhausted) // capped

    // The member decides again, so the cap no longer applies to the new choice.
    await client.markWatched('c1e1', true)
    const afterMark = events.length
    expect(afterMark).toBe(exhausted + 1)

    await client.reconcileMarks()
    expect(events.length).toBe(afterMark + 1)
  })

  it('treats a mark as stale when the point moved on another device', async () => {
    const events: Record<string, any>[] = []
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.CONTENT]: () => ({
        Contents: {
          docs: [
            cmsCard({
              contentVideo: { video: { video: 'https://cdn.example/e1.m3u8' } }
            })
          ]
        },
        currentProgress: stored
      }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1)],
      collections: [indexedCollection()]
    })

    await client.markWatched('c1e1', true)

    // The same routes now serve the point another machine left behind.
    stored = { videoProgress: 40, videoProgressSeconds: 1320 }
    await client.reconcileMarks()

    // The older choice must not roll that back, and must stop masking it.
    expect(events).toHaveLength(1)
    const data = (await client.collection('campaign-1'))!
    expect(data.seasons[0].items[0]).toMatchObject({ progress: 0.4, watched: false })
  })

  it('resumes a stale-marked episode where the account actually is', async () => {
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.CONTENT]: () => ({
        Contents: {
          docs: [
            cmsCard({
              contentVideo: { video: { video: 'https://cdn.example/e1.m3u8' } }
            })
          ]
        },
        currentProgress: stored
      }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    stored = { videoProgress: 40, videoProgressSeconds: 1320 }

    // No reconcile and no prior read: the mark is still in the store when the
    // page resolves it, which is the case where reading `marked` too early
    // used to start the episode over.
    const page = await client.content('c1e1')
    expect(page).toMatchObject({ watched: false, resumeAt: 1320 })

    // The player gets the same point through the cache the page handed it.
    await expect(client.play('c1e1')).resolves.toMatchObject({ resumeAt: 1320 })
  })

  it('starts a stale-marked episode where the account is, even from the player', async () => {
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.MEDIA]: () => ({
        Contents: {
          docs: [
            cmsCard({
              contentVideo: { video: { video: 'https://cdn.example/e1.m3u8' } }
            })
          ]
        },
        currentProgress: stored
      }),
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    stored = { videoProgress: 40, videoProgressSeconds: 1320 }

    // The content page was never opened, so `play` is the only reader.
    await expect(client.play('c1e1')).resolves.toMatchObject({ resumeAt: 1320 })
  })

  it('starts a marked-watched episode from the beginning while the server lags', async () => {
    const stored = { videoProgress: 50, videoProgressSeconds: 1650 }
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.MEDIA]: () => ({
        Contents: {
          docs: [
            cmsCard({
              contentVideo: { video: { video: 'https://cdn.example/e1.m3u8' } }
            })
          ]
        },
        currentProgress: stored
      }),
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)

    await expect(client.play('c1e1')).resolves.toMatchObject({ resumeAt: 0 })
  })

  it('still retries when the point barely changed', async () => {
    const events: Record<string, any>[] = []
    let stored = { videoProgress: 10, videoProgressSeconds: 300 }
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)

    // Five seconds is reporting jitter, not someone watching the episode.
    stored = { videoProgress: 10, videoProgressSeconds: 305 }
    await client.reconcileMarks()

    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ content: 'e1', videoProgress: 97 })
  })

  it('fills in a watched mark carried over without a point', async () => {
    const events: Record<string, any>[] = []
    const removed: string[] = []
    routeCms({
      // An empty read leaves the mark with no recorded point, the way a mark
      // written by an older build looks.
      [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: (variables) => {
        removed.push(variables.id)
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    await client.reconcileMarks()

    // Nothing to protect on an episode nobody started, so the point is filled
    // in at the last second and the row is left alone.
    expect(events.map((event) => [event.videoProgress, event.videoProgressSeconds])).toEqual([
      [97, 3299],
      [97, 3299]
    ])
    expect(removed).toEqual([])
  })

  it('does not wipe a point another device started when the mark has no point', async () => {
    const events: Record<string, any>[] = []
    let stored: { videoProgress: number; videoProgressSeconds: number } | null = null
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: stored ? [{ contentId: 'e1', ...stored }] : [] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1)],
      collections: [indexedCollection()]
    })

    await client.markWatched('c1e1', false)

    // Someone started the episode elsewhere; the older "unwatched" must not
    // wipe that point, and must stop masking it.
    stored = { videoProgress: 50, videoProgressSeconds: 1650 }
    await client.reconcileMarks()

    expect(events).toHaveLength(1)
    const data = (await client.collection('campaign-1'))!
    expect(data.seasons[0].items[0]).toMatchObject({ progress: 0.5, watched: false })
  })

  it('sends an unwatched mark again, with its row removal', async () => {
    const events: Record<string, any>[] = []
    const removed: string[] = []
    const stored = { videoProgress: 97, videoProgressSeconds: 3299 }
    routeCms({
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: { timeMap: [{ contentId: 'e1', ...stored }] }
      }),
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: (variables) => {
        removed.push(variables.id)
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', false)
    expect(events.map((event) => [event.videoProgress, event.videoProgressSeconds])).toEqual([
      [1, 1]
    ])
    expect(removed).toEqual(['e1'])

    // The server still has the finished point, so the write was lost.
    await client.reconcileMarks()

    expect(events.map((event) => [event.videoProgress, event.videoProgressSeconds])).toEqual([
      [1, 1],
      [1, 1]
    ])
    expect(removed).toEqual(['e1', 'e1'])
  })

  it('lets playback supersede a mark that has not been sent', async () => {
    const events: Record<string, any>[] = []
    let removed = 0
    let attempts = 0
    routeCms({
      [Q.TRACK]: (variables) => {
        attempts += 1
        if (attempts === 1) throw new Error('Beacon is busy')
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => {
        removed += 1
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)
    await client.trackProgress('e1', 120, 3300)
    await client.flushProgress()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      content: 'e1',
      videoProgress: 4,
      videoProgressSeconds: 120
    })
    expect(removed).toBe(0)
  })

  it('takes an episode back to the start when marked unwatched', async () => {
    let event: Record<string, any> | null = null
    let removed: string | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: (variables) => {
        removed = variables.id
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await expect(client.markWatched('c1e1', false)).resolves.toEqual({
      watched: false,
      progress: 0
    })

    // An all-zero report is ignored by Beacon, so the smallest real position is
    // the one that replaces the finished point.
    expect(event).toMatchObject({
      content: 'e1',
      videoProgress: 1,
      videoProgressSeconds: 1
    })
    // The removal zeroes the point, which is exactly where this mark wants it.
    expect(removed).toBe('e1')
  })

  it('retries a failed removal from Continue watching instead of dropping it', async () => {
    const events: Record<string, any>[] = []
    const removals: string[] = []
    let refuses = true
    routeCms({
      [Q.TRACK]: (variables) => {
        events.push(...variables.events)
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: (variables) => {
        if (refuses) throw new Error('not in the row')
        removals.push(variables.id)
        return { removeContentFromContinueWatching: { success: true } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    // The mark itself still takes effect locally even when the row removal
    // fails; only the removal is left owed to Beacon.
    await expect(client.markWatched('c1e1', false)).resolves.toEqual({
      watched: false,
      progress: 0
    })
    expect(events).toHaveLength(1)
    expect(removals).toEqual([])

    refuses = false
    await expect(client.flushProgress()).resolves.toBe(true)

    // The event stayed queued, so its point was re-sent and the removal
    // finally landed instead of being swallowed.
    expect(events).toHaveLength(2)
    expect(removals).toEqual(['e1'])
  })

  it('finds a slug the catalog index does not know yet', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.LOOKUP]: () => ({ Contents: { docs: [{ id: 'e7', duration: 1_800_000 }] } }),
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()

    await client.markWatched('fresh-episode', true)

    expect(event).toMatchObject({
      content: 'e7',
      videoProgress: 97,
      videoProgressSeconds: 1799
    })
  })

  it('requires a signed-in account', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const client = new BeaconClient()

    await expect(client.markWatched('c1e1', true)).rejects.toThrow('Sign in with a Beacon account')
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('keeps the mark when Beacon does not accept the write', async () => {
    routeCms({
      [Q.TRACK]: () => ({ trackView: { success: false } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: false }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await expect(client.markWatched('c1e1', true)).resolves.toEqual({
      watched: true,
      progress: 1
    })
  })

  it('keeps a mark while Beacon still reports the old point', async () => {
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: 50, videoProgressSeconds: 1650 }]
        }
      }),
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1)],
      collections: [indexedCollection()]
    })

    // Beacon answers success but the read still says 50%; the mark must win.
    await client.markWatched('c1e1', true)
    const data = (await client.collection('campaign-1'))!

    expect(data.seasons[0].items[0]).toMatchObject({
      slug: 'c1e1',
      progress: 1,
      watched: true
    })
  })

  it('lets real playback replace a mark', async () => {
    let percent = 50
    let seconds = 1650
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { docs: [{ content: cmsCard() }] } }),
      [Q.PROGRESS_FOR]: () => ({
        getProgressForContent: {
          timeMap: [{ contentId: 'e1', videoProgress: percent, videoProgressSeconds: seconds }]
        }
      }),
      [Q.TRACK]: (variables) => {
        percent = variables.events[0].videoProgress
        seconds = variables.events[0].videoProgressSeconds
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1)],
      collections: [indexedCollection()]
    })

    await client.markWatched('c1e1', true)
    await client.trackProgress('e1', 900, 3300)

    const data = (await client.collection('campaign-1'))!

    expect(data.seasons[0].items[0]).toMatchObject({
      slug: 'c1e1',
      progress: 0.27,
      watched: false
    })
  })

  it('keeps a marked title out of Continue watching', async () => {
    routeCms(
      homeRoutes({
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: {
            docs: [
              {
                videoProgress: 50,
                videoProgressSeconds: 1650,
                content: cmsCard({ id: 'e1', slug: 'c1e1' })
              }
            ]
          }
        }),
        [Q.TRACK]: () => ({ trackView: { success: true } }),
        [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
          removeContentFromContinueWatching: { success: true }
        })
      })
    )
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.markWatched('c1e1', true)

    // The row is hidden by the finished rule, not by the removal mutation: a
    // watched mark leaves its 97% point on the server so other devices see it.
    const home = await client.home()
    expect(home.rows.find((row) => row.title === 'Continue watching')).toBeUndefined()
  })
})

describe('search', () => {
  it('merges local and remote results without duplicates', async () => {
    const local = indexedVideo(1, { slug: 'local', title: 'Local Result' })
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SEARCH]: () => ({
        search: {
          docs: [
            cmsCard({ slug: 'local', title: 'Local Result' }),
            cmsCard({ slug: 'remote', title: 'Remote Result' })
          ]
        }
      })
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [local],
      collections: [
        {
          id: 's1',
          slug: 'campaign-1',
          name: 'Campaign 1',
          isSeries: true,
          itemCount: 10,
          released: null,
          image: 'https://images.example/collection/format=auto',
          image2x: null,
          portrait: null
        }
      ]
    })

    const results = await client.search('campaign')

    expect(results.videos.map((card) => card.slug)).toEqual(['local', 'remote'])
    expect(results.series).toEqual([
      {
        kind: 'series',
        id: 's1',
        slug: 'campaign-1',
        title: 'Campaign 1',
        image: 'https://images.example/collection/format=auto,width=480',
        image2x: null,
        count: 10
      }
    ])
  })

  it('passes suggestions through to the catalog', () => {
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ suggestions: ['Campaign 1'] })
    expect(client.suggest('cam')).toEqual(['Campaign 1'])

    client.catalog = null
    expect(client.suggest('cam')).toEqual([])
  })

  it('keeps local results when the remote search fails', async () => {
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SEARCH]: () => {
        throw new Error('search down')
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({
      videos: [indexedVideo(1, { slug: 'local', title: 'Local Result' })]
    })

    const results = await client.search('local')

    expect(results.series).toEqual([])
    expect(results.videos.map((card) => card.slug)).toEqual(['local'])
  })

  it('asks again after a search that found nothing', async () => {
    let searches = 0
    routeCms({
      [Q.ME]: () => MEMBER,
      [Q.SEARCH]: () => {
        searches += 1
        return { search: { docs: [] } }
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog()

    await client.search('nothing')
    await client.search('nothing')

    expect(searches).toBe(2)
  })
})

describe('caching', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  function cmsCalls(query: string): number {
    return net.fetch.mock.calls.filter((call) => {
      const body = (call[1] as { body?: string } | undefined)?.body
      return body ? (JSON.parse(body) as { query?: string }).query === query : false
    }).length
  }

  function episodeRoutes(overrides: Routes = {}): Routes {
    return {
      [Q.ME]: () => MEMBER,
      [Q.CONTENT]: () => ({
        Contents: {
          docs: [
            cmsCard({
              id: 'e1',
              slug: 'c1e1',
              contentVideo: { video: { video: 'https://cdn.jwplayer.com/manifests/abc.m3u8' } }
            })
          ]
        },
        currentProgress: { videoProgress: 10, videoProgressSeconds: 30 }
      }),
      [Q.SERIES]: () => ({ fetchSeries: {} }),
      [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } }),
      [Q.MEDIA]: () => ({ Contents: { docs: [] } }),
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      ...overrides
    }
  }

  it('serves a second Home from memory', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [blockContent({ id: 'r1', slug: 'recent', title: 'Recent' })]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    await client.home()
    await client.home()

    expect(cmsCalls(Q.HOME_BLOCKS)).toBe(1)
    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(1)
  })

  it('shares one Home request between concurrent callers', async () => {
    routeCms(homeRoutes())
    const client = new BeaconClient()

    await Promise.all([client.home(), client.home()])

    expect(cmsCalls(Q.HOME_BLOCKS)).toBe(1)
    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(1)
  })

  it('shares one meMember query between the account check and the feed', async () => {
    routeCms(homeRoutes())
    const client = new BeaconClient()

    const [status] = await Promise.all([client.status(), client.home()])

    expect(status.signedIn).toBe(true)
    expect(cmsCalls(Q.ME)).toBe(1)
  })

  it('writes the feed for the account and clears it on sign-out', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [blockContent({ id: 'r1', slug: 'recent', title: 'Recent' })]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()
    const store = {
      read: vi.fn(() => null),
      saveHome: vi.fn(),
      saveFavourites: vi.fn(),
      clear: vi.fn()
    }
    client.homeStore = store as unknown as HomeStore

    await client.home()
    expect(store.saveHome).toHaveBeenCalledWith('member@example.com', expect.any(Object))

    await client.signOut()
    expect(store.clear).toHaveBeenCalledOnce()
  })

  it('does not cache a feed read that a watch mark overtook', async () => {
    const homeBlock = deferred<unknown>()
    net.fetch.mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as { query?: string }) : {}
      switch (body.query) {
        case Q.HOME_BLOCKS:
          return response({ data: await homeBlock.promise })
        case Q.CONTINUE_WATCHING:
          return response({ data: { continueWatching: { docs: [] } } })
        case Q.ME:
          return response({ data: MEMBER })
        case Q.LOOKUP:
          return response({ data: { Contents: { docs: [{ id: 'e1', duration: 100_000 }] } } })
        case Q.PROGRESS_FOR:
          return response({ data: { getProgressForContent: { timeMap: [] } } })
        case Q.TRACK:
          return response({ data: { trackView: { success: true } } })
        default:
          throw new Error(`unrouted query: ${String(body.query).slice(0, 40)}`)
      }
    })
    const client = new BeaconClient()
    const store = {
      read: vi.fn(() => null),
      saveHome: vi.fn(),
      saveFavourites: vi.fn(),
      clear: vi.fn()
    }
    client.homeStore = store as unknown as HomeStore

    const pending = client.home()
    await vi.waitFor(() => expect(cmsCalls(Q.HOME_BLOCKS)).toBe(1))

    await client.markWatched('c1e1', true)

    homeBlock.resolve({
      MemberHomePage: {
        pageContent: [
          {
            __typename: 'LatestCarousel',
            id: 'latest-block',
            title: 'Latest Videos',
            content: [blockContent({ id: 'r1', slug: 'recent', title: 'Recent' })]
          }
        ]
      }
    })

    await expect(pending).resolves.toMatchObject({ rows: expect.any(Array) })
    expect(store.saveHome).not.toHaveBeenCalled()
  })

  it('does not cache a feed read that a progress write overtook', async () => {
    const homeBlock = deferred<unknown>()
    net.fetch.mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as { query?: string }) : {}
      switch (body.query) {
        case Q.HOME_BLOCKS:
          return response({ data: await homeBlock.promise })
        case Q.CONTINUE_WATCHING:
          return response({ data: { continueWatching: { docs: [] } } })
        case Q.ME:
          return response({ data: MEMBER })
        case Q.TRACK:
          return response({ data: { trackView: { success: true } } })
        default:
          throw new Error(`unrouted query: ${String(body.query).slice(0, 40)}`)
      }
    })
    const client = new BeaconClient()
    const store = {
      read: vi.fn(() => null),
      saveHome: vi.fn(),
      saveFavourites: vi.fn(),
      clear: vi.fn()
    }
    client.homeStore = store as unknown as HomeStore

    const pending = client.home()
    await vi.waitFor(() => expect(cmsCalls(Q.HOME_BLOCKS)).toBe(1))

    // A progress write lands while the feed read is still waiting on the CMS.
    await client.trackProgress('e1', 30, 100)
    await client.flushProgress()

    homeBlock.resolve({
      MemberHomePage: {
        pageContent: [
          {
            __typename: 'LatestCarousel',
            id: 'latest-block',
            title: 'Latest Videos',
            content: [blockContent({ id: 'r1', slug: 'recent', title: 'Recent' })]
          }
        ]
      }
    })

    await expect(pending).resolves.toMatchObject({ rows: expect.any(Array) })
    // The answer predates the write, so it is shown to this caller but must
    // not become the next launch's cached Home.
    expect(store.saveHome).not.toHaveBeenCalled()
  })

  it('reads the cached feed and Favourites row for the account in the session', async () => {
    const client = new BeaconClient()
    const store = {
      read: vi.fn(() => ({ home: null, favourites: null })),
      saveHome: vi.fn(),
      saveFavourites: vi.fn(),
      clear: vi.fn()
    }
    client.homeStore = store as unknown as HomeStore

    await expect(client.cachedHome()).resolves.toBeNull()
    await expect(client.cachedFavourites()).resolves.toBeNull()

    expect(store.read).toHaveBeenCalledWith('member@example.com')
  })

  it('does not hide a CMS failure as an empty home', async () => {
    net.fetch.mockRejectedValue(new Error('offline'))
    const client = new BeaconClient()

    await expect(client.home()).rejects.toThrow('offline')

    net.fetch.mockReset()
    routeCms(homeRoutes())
    await client.home()

    expect(cmsCalls(Q.HOME_BLOCKS)).toBe(1)
  })

  it('reads Home only after a progress report that was still on its way', async () => {
    // The player closes and reports as the feed reloads; Beacon would answer
    // "Continue watching" without the title if the read went first.
    const report = deferred<unknown>()
    let started = 0
    routeCms(
      homeRoutes({
        [Q.TRACK]: () => {
          started += 1
          return report.promise
        },
        [Q.CONTINUE_WATCHING]: () => ({
          continueWatching: { docs: [{ videoProgress: 4, content: cmsCard() }] }
        })
      })
    )
    const client = new BeaconClient()

    const reported = client.trackProgress('e1', 120, 3300)
    const feed = client.home()

    await vi.waitFor(() => expect(started).toBe(1))
    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(0)

    report.resolve({ trackView: { success: true } })
    await reported
    const home = await feed

    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(1)
    expect(home.rows[0]).toMatchObject({ title: 'Continue watching' })
    expect(home.rows[0].items[0].slug).toBe('c1e1')
  })

  it('reloads Home after the report lands', async () => {
    let watching: unknown[] = []
    routeCms(
      homeRoutes({
        [Q.TRACK]: (variables) => {
          watching = [{ videoProgress: 4, content: cmsCard({ id: variables.events[0].content }) }]
          return { trackView: { success: true } }
        },
        [Q.CONTINUE_WATCHING]: () => ({ continueWatching: { docs: watching } })
      })
    )
    const client = new BeaconClient()

    await expect(client.home()).resolves.toMatchObject({ rows: [] })

    await client.trackProgress('e1', 120, 3300)
    const home = await client.home()

    expect(home.rows[0]).toMatchObject({ title: 'Continue watching' })
    expect(home.rows[0].items[0]).toMatchObject({ slug: 'c1e1', progress: 0.04 })
  })

  it('reads Home rather than wait forever on a report that never lands', async () => {
    vi.useFakeTimers()
    routeCms(homeRoutes({ [Q.TRACK]: () => new Promise(() => {}) }))
    const client = new BeaconClient()

    void client.trackProgress('e1', 120, 3300)
    const feed = client.home()

    await vi.advanceTimersByTimeAsync(6_000)

    await expect(feed).resolves.toMatchObject({ rows: [] })
  })

  it('serves an episode page from memory until progress is reported', async () => {
    routeCms(episodeRoutes())
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.content('c1e1')
    await client.content('c1e1')
    expect(cmsCalls(Q.CONTENT)).toBe(1)

    await client.trackProgress('e1', 300, 600)
    await client.content('c1e1')
    expect(cmsCalls(Q.CONTENT)).toBe(2)
  })

  it('starts playback from the stream the episode page already fetched', async () => {
    routeCms(episodeRoutes())
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await client.content('c1e1')
    const playback = await client.play('c1e1')

    expect(playback?.url).toBe('https://cdn.jwplayer.com/manifests/abc.m3u8')
    expect(cmsCalls(Q.MEDIA)).toBe(0)
  })

  it('reuses a progress map for the same set of ids', async () => {
    routeCms({ [Q.PROGRESS_FOR]: () => ({ getProgressForContent: { timeMap: [] } }) })
    const client = new BeaconClient()

    await client.progressFor(['a', 'b'])
    await client.progressFor(['b', 'a'])

    expect(cmsCalls(Q.PROGRESS_FOR)).toBe(1)
  })

  it('drops every cache when the account changes', async () => {
    routeCms(
      homeRoutes({
        [Q.HOME_BLOCKS]: () => ({
          MemberHomePage: {
            pageContent: [
              {
                __typename: 'LatestCarousel',
                id: 'latest-block',
                title: 'Latest Videos',
                content: [blockContent({ id: 'r1', slug: 'recent', title: 'Recent' })]
              }
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    await client.home()
    await client.signOut()
    await client.home()

    expect(cmsCalls(Q.HOME_BLOCKS)).toBe(2)
  })

  it('reuses the level that the boot status already learned', async () => {
    routeCms(homeRoutes())
    const client = new BeaconClient()

    await client.status()
    await client.home()

    expect(cmsCalls(Q.ME)).toBe(1)
  })
})

describe('gql', () => {
  it('refreshes the token once after a 401', async () => {
    let cmsCalls = 0
    net.fetch.mockImplementation(
      async (url: string, init?: { headers?: Record<string, string> }) => {
        if (String(url).includes('oauth/token')) {
          return response({
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            expires_in: 3600
          })
        }
        cmsCalls++
        if (cmsCalls === 1) return response({}, 401)
        expect(init?.headers?.authorization).toBe('Bearer access-2')
        return response({ data: { ok: true } })
      }
    )
    const client = new BeaconClient()

    await expect(client.gql<{ ok: boolean }>(Q.ME)).resolves.toEqual({ ok: true })

    const [refreshUrl, refreshInit] = net.fetch.mock.calls[1] as [string, { body?: string }]
    expect(refreshUrl).toBe('https://pocketbeacon.memberful.com/oauth/token')
    expect(refreshUrl).not.toContain('refresh-1')
    const form = new URLSearchParams(refreshInit.body)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('refresh-1')
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-2', refreshToken: 'refresh-2' })
    )
  })

  it('joins GraphQL error messages', async () => {
    net.fetch.mockImplementation(async () =>
      response({ errors: [{ message: 'Not authorised' }, { message: 'Try again' }] })
    )
    const client = new BeaconClient()

    const failure = await client.gql(Q.ME).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BeaconError)
    expect((failure as BeaconError).message).toBe('Not authorised; Try again')
    expect((failure as BeaconError).status).toBe(200)
  })

  it('falls back to the HTTP status when the body is not JSON', async () => {
    net.fetch.mockImplementation(
      async () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('not json')
          }
        }) as unknown as Response
    )
    const client = new BeaconClient()

    const failure = await client.gql(Q.ME).catch((error: unknown) => error)

    expect((failure as BeaconError).message).toBe('Beacon answered HTTP 502')
    expect((failure as BeaconError).status).toBe(502)
  })
})

describe('favourites', () => {
  it('reads every page of the account list without duplicates', async () => {
    routeCms({
      [Q.FAVOURITE_COLLECTIONS]: (variables) =>
        variables.page === 1
          ? {
              userCollectionFavourites: {
                totalPages: 2,
                docs: [{ id: 'c1' }, { id: 'c2' }]
              }
            }
          : {
              userCollectionFavourites: {
                totalPages: 2,
                docs: [{ id: 'c2' }, { id: 'c3' }]
              }
            }
    })
    const client = new BeaconClient()

    await expect(client.favouriteCollectionIds()).resolves.toEqual(['c1', 'c2', 'c3'])
  })

  it('writes only when the account is not already in the wanted state', async () => {
    let favourited = true
    routeCms({
      [Q.IS_COLLECTION_FAVOURITE]: () => ({ isCollectionFavourite: favourited }),
      [Q.TOGGLE_COLLECTION_FAVOURITE]: () => {
        favourited = !favourited
        return {
          toggleCollectionFavourite: { success: true, isFavourite: favourited }
        }
      }
    })
    const client = new BeaconClient()
    const toggles = (): number =>
      net.fetch.mock.calls.filter(([, init]) =>
        String((init as { body?: string } | undefined)?.body).includes(
          'toggleCollectionFavouriteEndpoint'
        )
      ).length

    await expect(client.setCollectionFavourite('c1', true)).resolves.toBe(true)
    expect(toggles()).toBe(0)

    await expect(client.setCollectionFavourite('c1', false)).resolves.toBe(false)
    expect(toggles()).toBe(1)
  })

  it('surfaces the reason a favourite was refused', async () => {
    routeCms({
      [Q.IS_COLLECTION_FAVOURITE]: () => ({ isCollectionFavourite: false }),
      [Q.TOGGLE_COLLECTION_FAVOURITE]: () => ({
        toggleCollectionFavourite: {
          success: false,
          reason: 'You must be logged in to favourite collections.',
          isFavourite: null
        }
      })
    })
    const client = new BeaconClient()

    await expect(client.setCollectionFavourite('c1', true)).rejects.toThrow(
      'You must be logged in to favourite collections.'
    )
  })

  it('serializes two writes for the same collection', async () => {
    let favourited = false
    let toggles = 0
    net.fetch.mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      if (body.query === Q.IS_COLLECTION_FAVOURITE) {
        return response({ data: { isCollectionFavourite: favourited } })
      }
      if (body.query === Q.TOGGLE_COLLECTION_FAVOURITE) {
        // Hold the write open long enough for a second press to arrive.
        await new Promise((resolve) => setTimeout(resolve, 5))
        favourited = !favourited
        toggles++
        return response({
          data: { toggleCollectionFavourite: { success: true, isFavourite: favourited } }
        })
      }
      throw new Error('unrouted query')
    })
    const client = new BeaconClient()

    await Promise.all([
      client.setCollectionFavourite('c1', true),
      client.setCollectionFavourite('c1', true)
    ])

    expect(toggles).toBe(1)
    expect(favourited).toBe(true)
  })
})
