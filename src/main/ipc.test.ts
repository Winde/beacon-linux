import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IndexedCollection } from './beacon/catalog-types'

const glue = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as { close: () => void }[],
  fromContents: null as any,
  exposed: null as Record<string, Record<string, (...args: any[]) => unknown>> | null,
  invoked: [] as string[],
  app: {
    getPath: vi.fn(() => 'C:/tmp/beacon-linux-test'),
    getVersion: vi.fn(() => '9.9.9'),
    relaunch: vi.fn(),
    quit: vi.fn()
  },
  updater: {
    check: vi.fn(),
    notes: vi.fn(),
    install: vi.fn()
  },
  client: {
    status: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    accountEmail: vi.fn(() => Promise.resolve('member@example.com')),
    favouriteCollectionIds: vi.fn(() => Promise.resolve([])),
    setCollectionFavourite: vi.fn(() => Promise.resolve(true)),
    home: vi.fn(),
    cachedPages: vi.fn(() => Promise.resolve({ collections: [], contents: [] })),
    collection: vi.fn(),
    content: vi.fn(),
    search: vi.fn(),
    suggest: vi.fn(),
    play: vi.fn(),
    nextEpisode: vi.fn(),
    markWatched: vi.fn(),
    trackProgress: vi.fn(),
    trackStart: vi.fn(),
    flushProgress: vi.fn(),
    catalog: null as unknown
  },
  catalog: {
    status: vi.fn(),
    ensure: vi.fn(() => Promise.resolve()),
    allCollections: vi.fn((): IndexedCollection[] => []),
    collectionById: vi.fn(() => null),
    collectionBySlug: vi.fn(() => null)
  }
}))

vi.mock('electron', () => ({
  app: glue.app,
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      glue.handlers.set(channel, handler)
    }
  },
  BrowserWindow: {
    getAllWindows: () => glue.windows,
    fromWebContents: () => glue.fromContents
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, any>) => {
      glue.exposed = api
    }
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      glue.invoked.push(channel)
      return Promise.resolve(undefined)
    }
  },
  net: { fetch: vi.fn() }
}))

vi.mock('./beacon/client', () => ({
  BeaconClient: vi.fn(function () {
    return glue.client
  })
}))
vi.mock('./beacon/catalog', () => ({
  Catalog: vi.fn(function () {
    return glue.catalog
  })
}))
vi.mock('./hls', () => ({ fetchMasterPlaylist: vi.fn(), fetchCaptionFile: vi.fn() }))
vi.mock('./home-store', () => ({
  HomeStore: vi.fn(function () {
    return {
      read: vi.fn(() => null),
      saveHome: vi.fn(),
      saveFavourites: vi.fn(),
      clear: vi.fn()
    }
  })
}))
vi.mock('./updates', () => ({
  Updater: vi.fn(function () {
    return glue.updater
  }),
  currentAppImage: vi.fn(() => null),
  relaunchArgs: vi.fn((argv: string[]) => argv.filter((arg) => !arg.startsWith('--open=')))
}))

import '../preload/index'
import { registerIpc } from './ipc'
import { fetchCaptionFile, fetchMasterPlaylist } from './hls'

function handler(channel: string): (...args: any[]) => any {
  const found = glue.handlers.get(channel)
  if (!found) throw new Error(`no handler registered for ${channel}`)
  return found
}

beforeEach(() => {
  vi.resetAllMocks()
  glue.app.getPath.mockReturnValue('C:/tmp/beacon-linux-test')
  glue.app.getVersion.mockReturnValue('9.9.9')
  glue.updater.install.mockResolvedValue('/home/deck/Applications/Beacon.AppImage')
  glue.handlers.clear()
  glue.invoked.length = 0
  glue.windows = []
  glue.fromContents = null
  registerIpc()
})

describe('registerIpc', () => {
  it('registers a handler for every channel the preload bridge calls', () => {
    const api = glue.exposed
    expect(api).not.toBeNull()

    const channels: string[] = []
    for (const group of Object.values(api!)) {
      for (const call of Object.values(group)) {
        call()
        channels.push(glue.invoked.pop()!)
      }
    }

    // app:initialSlug is registered by main/index.ts, after registerIpc().
    const registered = new Set([...glue.handlers.keys(), 'app:initialSlug'])
    expect(new Set(channels)).toEqual(registered)
  })

  it('gives the client the catalog index', () => {
    expect(glue.client.catalog).toBe(glue.catalog)
  })

  it('delegates auth and catalog calls', async () => {
    glue.client.signIn.mockResolvedValue({ signedIn: true, user: null })
    glue.client.status.mockResolvedValue({ signedIn: false, user: null })
    glue.client.home.mockResolvedValue({ hero: [], rows: [] })
    glue.client.collection.mockResolvedValue({ slug: 'campaign-1' })
    glue.client.content.mockResolvedValue({ slug: 'c1e1' })
    glue.client.search.mockResolvedValue({ series: [], videos: [] })
    glue.client.suggest.mockResolvedValue(['Campaign 1'])
    glue.catalog.status.mockReturnValue({
      videos: 3,
      collections: 1,
      builtAt: null,
      building: false
    })

    await expect(handler('auth:signIn')({}, 'member@example.com', 'hunter2')).resolves.toEqual({
      signedIn: true,
      user: null
    })
    expect(glue.client.signIn).toHaveBeenCalledWith('member@example.com', 'hunter2')

    await handler('auth:status')()
    await handler('auth:signOut')()
    await handler('catalog:home')()
    await handler('catalog:cachedPages')()
    await handler('catalog:collection')({}, 'campaign-1')
    await handler('catalog:content')({}, 'c1e1')
    await handler('catalog:search')({}, 'vox')
    await expect(handler('catalog:suggest')({}, 'cam')).resolves.toEqual(['Campaign 1'])

    expect(glue.client.status).toHaveBeenCalled()
    expect(glue.client.signOut).toHaveBeenCalled()
    expect(glue.client.home).toHaveBeenCalled()
    expect(glue.client.cachedPages).toHaveBeenCalled()
    expect(glue.client.collection).toHaveBeenCalledWith('campaign-1')
    expect(glue.client.content).toHaveBeenCalledWith('c1e1')
    expect(glue.client.search).toHaveBeenCalledWith('vox')
    expect(glue.client.suggest).toHaveBeenCalledWith('cam')
  })

  it('lists every series and collection for the browse screen, by name', async () => {
    glue.catalog.allCollections.mockReturnValue([
      {
        id: 'c1',
        slug: 'campaign-1',
        name: 'Campaign 1',
        isSeries: true,
        itemCount: 10,
        released: null,
        image: null,
        image2x: null,
        portrait: null
      },
      {
        id: 'p1',
        slug: 'previously-on',
        name: 'Previously On...',
        isSeries: false,
        itemCount: 5,
        released: null,
        image: null,
        image2x: null,
        portrait: null
      },
      {
        id: 'c2',
        slug: 'age-of-umbra',
        name: 'Age of Umbra',
        isSeries: true,
        itemCount: 23,
        released: null,
        image: null,
        image2x: null,
        portrait: null
      }
    ])

    const data = await handler('catalog:browse')()

    expect(glue.catalog.ensure).toHaveBeenCalled()
    expect(data.series.map((card: { title: string }) => card.title)).toEqual([
      'Age of Umbra',
      'Campaign 1'
    ])
    expect(data.collections.map((card: { title: string }) => card.title)).toEqual([
      'Previously On...'
    ])
  })

  it('adds the reordered playlist to a play response', async () => {
    glue.client.play.mockResolvedValue({
      url: 'https://cdn.jwplayer.com/v2/media/abc/master.m3u8',
      playlist: null
    })
    vi.mocked(fetchMasterPlaylist).mockResolvedValue('rewritten')

    const data = await handler('playback:open')({}, 'c1e1')

    expect(glue.client.play).toHaveBeenCalledWith('c1e1')
    expect(fetchMasterPlaylist).toHaveBeenCalledWith(
      'https://cdn.jwplayer.com/v2/media/abc/master.m3u8'
    )
    expect(data.playlist).toBe('rewritten')
  })

  it('returns null when there is nothing to play', async () => {
    glue.client.play.mockResolvedValue(null)

    await expect(handler('playback:open')({}, 'missing')).resolves.toBeNull()
    expect(fetchMasterPlaylist).not.toHaveBeenCalled()
  })

  it('serves the original playlist when reordering fails', async () => {
    glue.client.play.mockResolvedValue({
      url: 'https://cdn.jwplayer.com/x.m3u8',
      playlist: 'original'
    })
    vi.mocked(fetchMasterPlaylist).mockRejectedValue(new Error('HTTP 500'))

    const data = await handler('playback:open')({}, 'c1e1')

    expect(data.playlist).toBeNull()
  })

  it('forwards watch progress and caption requests', async () => {
    vi.mocked(fetchCaptionFile).mockResolvedValue('WEBVTT')

    await handler('playback:progress')({}, { contentId: 'e1', position: 12, duration: 100 })
    await handler('playback:start')({}, 'e1')
    await handler('playback:flush')()
    await expect(handler('playback:captions')({}, 'https://cdn.example/en.vtt')).resolves.toBe(
      'WEBVTT'
    )

    expect(glue.client.trackProgress).toHaveBeenCalledWith('e1', 12, 100)
    expect(glue.client.trackStart).toHaveBeenCalledWith('e1')
    expect(glue.client.flushProgress).toHaveBeenCalled()
    expect(fetchCaptionFile).toHaveBeenCalledWith('https://cdn.example/en.vtt')
  })

  it('delegates favourites, watch marks and the next-episode request', async () => {
    glue.client.nextEpisode.mockResolvedValue(null)
    glue.client.markWatched.mockResolvedValue({ watched: true, progress: 1 })
    const card = {
      kind: 'series' as const,
      id: 'c1',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: null,
      image2x: null,
      count: 10
    }

    await expect(handler('favourites:list')()).resolves.toEqual({ items: [], after: null })
    glue.client.setCollectionFavourite.mockResolvedValueOnce(true)
    const added = await handler('favourites:add')({}, card)
    expect(glue.client.setCollectionFavourite).toHaveBeenCalledWith('c1', true)
    expect(added.items.map((item: { id: string }) => item.id)).toEqual(['c1'])

    glue.client.setCollectionFavourite.mockResolvedValueOnce(false)
    const removed = await handler('favourites:remove')({}, 'campaign-1')
    expect(glue.client.setCollectionFavourite).toHaveBeenLastCalledWith('c1', false)
    expect(removed.items).toEqual([])

    const request = { contentId: 'c1e1', collectionId: 'c1' }
    await handler('playback:next')({}, request)
    expect(glue.client.nextEpisode).toHaveBeenCalledWith(request)

    await expect(handler('watch:mark')({}, 'c1e1', true)).resolves.toEqual({
      watched: true,
      progress: 1
    })
    expect(glue.client.markWatched).toHaveBeenCalledWith('c1e1', true)
  })

  it('delegates the favourites row position without reading the account', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beacon-ipc-'))
    glue.app.getPath.mockReturnValue(directory)
    try {
      const data = await handler('favourites:setPosition')({}, 'featured')

      expect(data.after).toBe('featured')
      expect(glue.client.favouriteCollectionIds).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reports the credential storage and delegates an update check', async () => {
    await expect(handler('auth:storage')()).resolves.toBe('unavailable')

    const info = { current: '0.1.4', latest: '0.2.0', available: true, canInstall: true }
    glue.updater.check.mockResolvedValue(info)
    await expect(handler('updates:check')()).resolves.toEqual(info)
  })

  it('delegates the notes for a pending update', async () => {
    const notes = [{ version: '0.2.0', notes: 'Player changes.' }]
    glue.updater.notes.mockResolvedValue(notes)

    await expect(handler('updates:notes')()).resolves.toEqual(notes)
    expect(glue.updater.notes).toHaveBeenCalledOnce()
  })

  it('does nothing when a fullscreen request has no window', () => {
    glue.fromContents = null

    expect(() => handler('app:toggleFullscreen')({ sender: {} })).not.toThrow()
  })

  it('closes every window on quit', () => {
    glue.windows = [{ close: vi.fn() }, { close: vi.fn() }]

    handler('app:quit')()

    for (const window of glue.windows) expect(window.close).toHaveBeenCalled()
  })

  it('toggles fullscreen on the window that asked', () => {
    const window = { isFullScreen: vi.fn(() => false), setFullScreen: vi.fn() }
    glue.fromContents = window

    handler('app:toggleFullscreen')({ sender: {} })
    expect(window.setFullScreen).toHaveBeenLastCalledWith(true)

    window.isFullScreen.mockReturnValue(true)
    handler('app:toggleFullscreen')({ sender: {} })
    expect(window.setFullScreen).toHaveBeenLastCalledWith(false)
  })

  it('reports the platform', () => {
    expect(handler('app:platform')()).toBe(process.platform)
  })

  it('reports the running version', () => {
    expect(handler('app:version')()).toBe('9.9.9')
  })

  it('installs an update and relaunches the replaced AppImage', async () => {
    await handler('updates:install')({})

    expect(glue.updater.install).toHaveBeenCalledOnce()
    expect(glue.app.relaunch).toHaveBeenCalledWith({
      execPath: '/home/deck/Applications/Beacon.AppImage',
      args: process.argv.slice(1).filter((arg) => !arg.startsWith('--open='))
    })
    expect(glue.app.quit).toHaveBeenCalledOnce()
  })

  it('stays up when the update cannot be installed', async () => {
    glue.updater.install.mockRejectedValue(new Error('The downloaded update failed its checksum.'))

    await expect(handler('updates:install')({})).rejects.toThrow(/checksum/)
    expect(glue.app.relaunch).not.toHaveBeenCalled()
    expect(glue.app.quit).not.toHaveBeenCalled()
  })
})
