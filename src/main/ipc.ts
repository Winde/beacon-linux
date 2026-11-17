import { app, BrowserWindow, ipcMain } from 'electron'
import type { Card, FavouritesAnchor, NextEpisodeRequest, PlaybackData, ProgressReport } from '@shared/types'
import { BeaconClient } from './beacon/client'
import { Catalog } from './beacon/catalog'
import { credentialStorage } from './beacon/session'
import { FavouritesService } from './favourites'
import { fetchCaptionFile, fetchMasterPlaylist } from './hls'
import { PreferencesStore, preferencesPath } from './preferences'

export const client = new BeaconClient()
export const catalog = new Catalog(client)
client.catalog = catalog
export const favourites = new FavouritesService(
  client,
  catalog,
  new PreferencesStore(() => preferencesPath(app.getPath('userData')))
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

  ipcMain.handle('favourites:list', () => favourites.list())
  ipcMain.handle('favourites:add', (_event, card: Card) => favourites.add(card))
  ipcMain.handle('favourites:remove', (_event, slug: string) => favourites.remove(slug))
  ipcMain.handle('favourites:setPosition', (_event, after: FavouritesAnchor) =>
    favourites.setPosition(after)
  )

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

  ipcMain.handle('playback:start', (_event, contentId: string) => client.trackStart(contentId))

  ipcMain.handle('playback:flush', () => client.flushProgress())

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
