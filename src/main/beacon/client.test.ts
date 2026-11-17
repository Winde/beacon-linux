import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Q from './queries'
import type { IndexedCollection, IndexedVideo } from './catalog-types'
import type { CatalogLike } from './client'
import { BeaconClient, BeaconError } from './client'

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

function fakeCatalog(options: {
  videos?: IndexedVideo[]
  collections?: IndexedCollection[]
  suggestions?: string[]
} = {}): CatalogLike {
  const videos = options.videos ?? []
  const collections = options.collections ?? []
  return {
    ensure: async () => undefined,
    videoBySlug: (slug) => videos.find((video) => video.slug === slug) ?? null,
    collectionBySlug: (slug) => collections.find((collection) => collection.slug === slug) ?? null,
    videoById: (id) => videos.find((video) => video.id === id) ?? null,
    collectionById: (id) => collections.find((collection) => collection.id === id) ?? null,
    seriesVideos: () => videos,
    localSearch: () => ({ collections: options.collections ?? [], videos }),
    suggest: () => options.suggestions ?? []
  }
}

function homeRoutes(overrides: Routes = {}): Routes {
  return {
    [Q.ME]: () => MEMBER,
    [Q.CONTINUE_WATCHING]: () => ({ continueWatching: { docs: [] } }),
    [Q.SEARCH]: () => ({ search: { docs: [] } }),
    [Q.COLLECTIONS]: () => ({ collectionSearch: { docs: [] } }),
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
      { body?: string; headers?: Record<string, string> }
    ]
    expect(authUrl).toBe('https://pocketbeacon.memberful.com/oauth/token')
    expect(authUrl).not.toContain('hunter2')
    expect(authInit.headers?.['content-type']).toBe('application/x-www-form-urlencoded')
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
  it('assembles the rows from the CMS', async () => {
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
        [Q.SEARCH]: () => ({
          search: { docs: [cmsCard({ id: 'r1', slug: 'recent', title: 'Recent', duration: 3_000_000 })] }
        }),
        [Q.COLLECTIONS]: () => ({
          collectionSearch: {
            docs: [
              cmsCollection({ id: 's1', slug: 'campaign-1', name: 'Campaign 1', isSeries: true }),
              cmsCollection({ id: 'c1', slug: 'one-shots', name: 'One Shots', isSeries: false, itemCount: 4 }),
              cmsCollection({ id: 'c2', slug: 'empty', name: 'Empty', isSeries: false, itemCount: 0 })
            ]
          }
        })
      })
    )
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.rows.map((row) => row.title)).toEqual([
      'Continue watching',
      'Recently added',
      'Series',
      'Collections'
    ])
    expect(home.rows[0].items.map((item) => item.slug)).toEqual(['cw1'])
    expect(home.rows[0].items[0].progress).toBe(0.4)
    expect(home.rows[3].items.map((item) => item.slug)).toEqual(['one-shots'])
    expect(home.rows[2].items[0]).toMatchObject({ kind: 'series', count: 10 })
    expect(home.rows[1].items[0].minutes).toBe(50)
    expect(home.rows[1].items[0].image).toBe('https://images.example/landscape/format=auto,width=480')
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
    // Home calls 92% done; content() keeps a resume point up to 95% (see the
    // content tests), so an episode at 93% drops off the row yet reopens at its
    // timestamp when reached another way.
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

    expect(home.rows.find((row) => row.title === 'Continue watching')).toBeUndefined()
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

    const asked = net.fetch.mock.calls.map((call) => String(call[0]))
    expect(asked).toHaveLength(2)
  })

  it('locks items above the account tier', async () => {
    routeCms(
      homeRoutes({
        [Q.SEARCH]: () => ({
          search: {
            docs: [
              cmsCard({ slug: 'free', contentTier: { name: 'Apprentice', planLevel: 1 } }),
              cmsCard({ slug: 'paid', contentTier: { name: 'Exandria', planLevel: 3 } })
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

  it('builds the hero from long videos, capped at five', async () => {
    const docs = Array.from({ length: 7 }, (_, index) =>
      cmsCard({ slug: `recent-${index}`, duration: 2_400_000 })
    )
    routeCms(homeRoutes({ [Q.SEARCH]: () => ({ search: { docs } }) }))
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.hero.map((card) => card.slug)).toEqual([
      'recent-0',
      'recent-1',
      'recent-2',
      'recent-3',
      'recent-4'
    ])
    expect(home.hero[0].image).toBe('https://images.example/landscape/format=auto,width=1280')
    expect(home.hero[0].image2x).toBe('https://images.example/wide/format=auto,width=1280')
  })

  it('falls back to any recent video for the hero', async () => {
    const docs = [cmsCard({ slug: 'short-1', duration: 300_000 }), cmsCard({ slug: 'short-2', duration: 60_000 })]
    routeCms(homeRoutes({ [Q.SEARCH]: () => ({ search: { docs } }) }))
    const client = new BeaconClient()

    const home = await client.home()

    expect(home.hero.map((card) => card.slug)).toEqual(['short-1', 'short-2'])
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
      contentVideo: { video: { video: 'https://cdn.jwplayer.com/manifests/abc.m3u8' } },
      content: [{ carouselContent: [cmsCard({ id: 'rec1', slug: 'rec1', title: 'Recommended' })] }],
      ...overrides
    })
  }

  it('returns the details of a video', async () => {
    routeCms(contentRoutes(playableDoc()))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = await client.content('c1e5')

    expect(content).toMatchObject({
      id: 'e5',
      slug: 'c1e5',
      title: 'Campaign 1 Episode 1',
      description: 'An episode.',
      minutes: 55,
      released: '2024-01-01T00:00:00.000Z',
      series: { slug: 'campaign-1', title: 'Campaign 1' },
      tier: 'Apprentice',
      locked: false,
      signInNeeded: false,
      resumeAt: 125
    })
  })

  it('lists the next episode, more from the series and recommendations', async () => {
    routeCms(contentRoutes(playableDoc()))
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos })

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e8')

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

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e5')

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

    const content = await client.content('c1e5')

    expect(content.watched).toBe(false)
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

    const before = await client.content('c1e5')
    expect(before.watched).toBe(false)
    expect(before.resumeAt).toBe(300)

    await client.markWatched('c1e5', true)

    const after = await client.content('c1e5')
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
                          { kind: 'captions', label: 'English', file: 'https://cdn.example/en.vtt' },
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
  function routes(next: Card | null) {
    return {
      [Q.ME]: () => MEMBER,
      [Q.SERIES]: () => ({ fetchSeries: { next } })
    }
  }

  const request = {
    contentId: 'e5',
    collectionId: 's1',
    isSeries: true,
    episodeNumber: 5
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
      minutes: 55
    })
  })

  it('asks nothing for a video in a collection folder', async () => {
    routeCms({})
    const client = new BeaconClient()

    await expect(
      client.nextEpisode({ ...request, isSeries: false })
    ).resolves.toBeNull()
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('refuses an episode the account cannot watch', async () => {
    routeCms(
      routes(
        cmsCard({
          episodeNumber: 6,
          contentTier: { name: 'Exandria', planLevel: 3 }
        })
      )
    )
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toBeNull()
  })

  it('stops where the numbering restarts', async () => {
    // The pointer crosses into another miniseries at a season boundary.
    routeCms(routes(cmsCard({ episodeNumber: 1 })))
    const client = new BeaconClient()

    await expect(client.nextEpisode(request)).resolves.toBeNull()
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

    expect(event!.videoProgressSeconds).toBe(40)
    expect(event!.videoProgress).toBe(1)
  })

  it('does nothing when signed out', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const client = new BeaconClient()

    await expect(client.trackProgress('e1', 10, 100)).resolves.toBe(false)
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

    const data = await client.collection('campaign-1')

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

  it('marks an episode watched at its full runtime', async () => {
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

    await expect(client.markWatched('c1e1', true)).resolves.toEqual({
      watched: true,
      progress: 1
    })

    // One second inside the end, so the CMS cannot discard the extreme value.
    expect(event).toMatchObject({
      content: 'e1',
      videoProgress: 99,
      videoProgressSeconds: 3299
    })
    expect(removed).toBe('e1')
  })

  it('takes an episode back to the start when marked unwatched', async () => {
    let event: Record<string, any> | null = null
    routeCms({
      [Q.TRACK]: (variables) => {
        event = variables.events[0]
        return { trackView: { success: true } }
      },
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => ({
        removeContentFromContinueWatching: { success: true }
      })
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
  })

  it('still marks an episode when it cannot leave Continue watching', async () => {
    routeCms({
      [Q.TRACK]: () => ({ trackView: { success: true } }),
      [Q.REMOVE_FROM_CONTINUE_WATCHING]: () => {
        throw new Error('not in the row')
      }
    })
    const client = new BeaconClient()
    client.catalog = fakeCatalog({ videos: [indexedVideo(1)] })

    await expect(client.markWatched('c1e1', false)).resolves.toEqual({
      watched: false,
      progress: 0
    })
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
      videoProgress: 99,
      videoProgressSeconds: 1799
    })
  })

  it('requires a signed-in account', async () => {
    vi.mocked(loadSession).mockResolvedValue(null)
    const client = new BeaconClient()

    await expect(client.markWatched('c1e1', true)).rejects.toThrow(
      'Sign in with a Beacon account'
    )
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
    const data = await client.collection('campaign-1')

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

    const data = await client.collection('campaign-1')

    expect(data.seasons[0].items[0]).toMatchObject({
      slug: 'c1e1',
      progress: 0.27,
      watched: false
    })
  })

  it('drops a marked title from Continue watching', async () => {
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
        [Q.SEARCH]: () => ({
          search: { docs: [cmsCard({ id: 'r1', slug: 'recent', title: 'Recent' })] }
        })
      })
    )
    const client = new BeaconClient()

    await client.home()
    await client.home()

    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(1)
    expect(cmsCalls(Q.SEARCH)).toBe(1)
    expect(cmsCalls(Q.COLLECTIONS)).toBe(1)
  })

  it('shares one Home request between concurrent callers', async () => {
    routeCms(homeRoutes())
    const client = new BeaconClient()

    await Promise.all([client.home(), client.home()])

    expect(cmsCalls(Q.CONTINUE_WATCHING)).toBe(1)
  })

  it('does not remember an empty home after a CMS failure', async () => {
    net.fetch.mockRejectedValue(new Error('offline'))
    const client = new BeaconClient()
    await expect(client.home()).resolves.toEqual({ hero: [], rows: [] })

    net.fetch.mockReset()
    routeCms(homeRoutes())
    await client.home()

    expect(cmsCalls(Q.SEARCH)).toBe(1)
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
        [Q.SEARCH]: () => ({
          search: { docs: [cmsCard({ id: 'r1', slug: 'recent', title: 'Recent' })] }
        })
      })
    )
    const client = new BeaconClient()

    await client.home()
    await client.signOut()
    await client.home()

    expect(cmsCalls(Q.SEARCH)).toBe(2)
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
    net.fetch.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (String(url).includes('oauth/token')) {
        return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 })
      }
      cmsCalls++
      if (cmsCalls === 1) return response({}, 401)
      expect(init?.headers?.authorization).toBe('Bearer access-2')
      return response({ data: { ok: true } })
    })
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
        String((init as { body?: string } | undefined)?.body).includes('toggleCollectionFavouriteEndpoint')
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
