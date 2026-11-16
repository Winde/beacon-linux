import { app, BrowserWindow, ipcMain } from 'electron'
import type { Card, NextEpisodeRequest, PlaybackData, ProgressReport } from '@shared/types'
import { BeaconClient } from './beacon/client'
import { Catalog } from './beacon/catalog'
import { credentialStorage } from './beacon/session'
import { fetchCaptionFile, fetchMasterPlaylist } from './hls'
import { WatchlistService } from './watchlist-service'
import { WatchlistStore, watchlistPath } from './watchlist'

export const client = new BeaconClient()
export const catalog = new Catalog(client)
client.catalog = catalog
export const watchlist = new WatchlistService(
  new WatchlistStore(() => watchlistPath(app.getPath('userData'))),
  catalog
)

export function registerIpc(): void {
  ipcMain.handle('auth:status', () => client.status())
  ipcMain.handle('auth:signIn', (_event, email: string, password: string) =>
    client.signIn(email, password)
  )
  ipcMain.handle('auth:signOut', () => client.signOut())
  ipcMain.handle('auth:storage', () => credentialStorage())

  ipcMain.handle('catalog:home', () => client.home())
  ipcMain.handle('catalog:collection', (_event, slug: string) => client.collection(slug))
  ipcMain.handle('catalog:content', (_event, slug: string) => client.content(slug))
  ipcMain.handle('catalog:search', (_event, query: string) => client.search(query))
  ipcMain.handle('catalog:suggest', (_event, query: string) => client.suggest(query))
  ipcMain.handle('catalog:indexStatus', () => catalog.status())

  ipcMain.handle('watchlist:list', async () => watchlist.list(await client.accountEmail()))
  ipcMain.handle('watchlist:add', async (_event, card: Card) =>
    watchlist.add(await client.accountEmail(), card)
  )
  ipcMain.handle('watchlist:remove', async (_event, kind: Card['kind'], slug: string) =>
    watchlist.remove(await client.accountEmail(), kind, slug)
  )
  ipcMain.handle('watchlist:setPosition', async (_event, rowsAbove: number) =>
    watchlist.setPosition(await client.accountEmail(), rowsAbove)
  )
  ipcMain.handle('watchlist:clear', async () => watchlist.clear(await client.accountEmail()))

  ipcMain.handle('playback:open', async (_event, slug: string) => {
    const cached = await client.play(slug)
    if (!cached) return null
    // play() may hand back a cached object; keep per-open state out of it.
    const data: PlaybackData = { ...cached, playlist: null }
    try {
      data.playlist = await fetchMasterPlaylist(data.url)
    } catch {
      // Serve the original playlist; the player still works, just starts softer.
      data.playlist = null
    }
    return data
  })

  ipcMain.handle('playback:next', (_event, request: NextEpisodeRequest) =>
    client.nextEpisode(request)
  )

  ipcMain.handle('playback:progress', (_event, report: ProgressReport) =>
    client.trackProgress(report.contentId, report.position, report.duration)
  )

  ipcMain.handle('playback:captions', (_event, url: string) => fetchCaptionFile(url))

  ipcMain.handle('watch:mark', (_event, slug: string, watched: boolean) =>
    client.markWatched(slug, watched)
  )

  ipcMain.handle('app:quit', () => {
    for (const window of BrowserWindow.getAllWindows()) window.close()
  })

  ipcMain.handle('app:toggleFullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.setFullScreen(!window.isFullScreen())
  })

  ipcMain.handle('app:platform', () => process.platform)
}
