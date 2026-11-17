import { beforeEach, describe, expect, it, vi } from 'vitest'

const glue = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as { close: () => void }[],
  fromContents: null as any,
  exposed: null as Record<string, Record<string, (...args: any[]) => unknown>> | null,
  invoked: [] as string[],
  client: {
    status: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    accountEmail: vi.fn(() => Promise.resolve('member@example.com')),
    favouriteCollectionIds: vi.fn(() => Promise.resolve([])),
    setCollectionFavourite: vi.fn(() => Promise.resolve(true)),
    home: vi.fn(),
    collection: vi.fn(),
    content: vi.fn(),
    search: vi.fn(),
    suggest: vi.fn(),
    play: vi.fn(),
    trackProgress: vi.fn(),
    trackStart: vi.fn(),
    flushProgress: vi.fn(),
    catalog: null as unknown
  },
  catalog: { status: vi.fn() }
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/tmp/beacon-linux-test' },
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
  }
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
    glue.catalog.status.mockReturnValue({ videos: 3, collections: 1, builtAt: null, building: false })

    await expect(handler('auth:signIn')({}, 'member@example.com', 'hunter2')).resolves.toEqual({
      signedIn: true,
      user: null
    })
    expect(glue.client.signIn).toHaveBeenCalledWith('member@example.com', 'hunter2')

    await handler('auth:status')()
    await handler('auth:signOut')()
    await handler('catalog:home')()
    await handler('catalog:collection')({}, 'campaign-1')
    await handler('catalog:content')({}, 'c1e1')
    await handler('catalog:search')({}, 'vox')
    await expect(handler('catalog:suggest')({}, 'cam')).resolves.toEqual(['Campaign 1'])
    await handler('catalog:indexStatus')()

    expect(glue.client.status).toHaveBeenCalled()
    expect(glue.client.signOut).toHaveBeenCalled()
    expect(glue.client.home).toHaveBeenCalled()
    expect(glue.client.collection).toHaveBeenCalledWith('campaign-1')
    expect(glue.client.content).toHaveBeenCalledWith('c1e1')
    expect(glue.client.search).toHaveBeenCalledWith('vox')
    expect(glue.client.suggest).toHaveBeenCalledWith('cam')
    expect(glue.catalog.status).toHaveBeenCalled()
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
    glue.client.play.mockResolvedValue({ url: 'https://cdn.jwplayer.com/x.m3u8', playlist: 'original' })
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
})
