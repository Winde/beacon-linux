import { app, BrowserWindow, ipcMain, net } from 'electron'
import type {
  BrowseData,
  Card,
  FavouritesAnchor,
  NextEpisodeRequest,
  PlaybackData,
  ProgressReport
} from '@shared/types'
import { BeaconClient } from './beacon/client'
import { Catalog } from './beacon/catalog'
import { indexedCollectionCard } from './beacon/cards'
import { credentialStorage } from './beacon/session'
import { FavouritesService } from './favourites'
import { fetchCaptionFile, fetchMasterPlaylist } from './hls'
import { PreferencesStore, preferencesPath } from './preferences'
import { currentAppImage, relaunchArgs, Updater } from './updates'

export const client = new BeaconClient()
export const catalog = new Catalog(client)
client.catalog = catalog
export const favourites = new FavouritesService(
  client,
  catalog,
  new PreferencesStore(() => preferencesPath(app.getPath('userData')))
)
const updater = new Updater({
  currentVersion: () => app.getVersion(),
  appImage: () => currentAppImage(process.env),
  // Electron's net stack, like the rest of the app: it follows the system's
  // proxy settings where Node's own fetch would not.
  fetch: (url, init) => net.fetch(url, init)
})

export function registerIpc(): void {
  ipcMain.handle('auth:status', () => client.status())
  ipcMain.handle('auth:signIn', (_event, email: string, password: string) =>
    client.signIn(email, password)
  )
  ipcMain.handle('auth:signOut', () => client.signOut())
  ipcMain.handle('auth:storage', () => credentialStorage())

  ipcMain.handle('catalog:home', () => client.home())
  ipcMain.handle('catalog:browse', async (): Promise<BrowseData> => {
    await catalog.ensure()
    const all = catalog.allCollections()
    const byName = (a: { name: string }, b: { name: string }): number =>
      a.name.localeCompare(b.name)
    return {
      series: all
        .filter((c) => c.isSeries)
        .sort(byName)
        .map(indexedCollectionCard),
      collections: all
        .filter((c) => !c.isSeries)
        .sort(byName)
        .map(indexedCollectionCard)
    }
  })
  ipcMain.handle('catalog:collection', (_event, slug: string) => client.collection(slug))
  ipcMain.handle('catalog:content', (_event, slug: string) => client.content(slug))
  ipcMain.handle('catalog:search', (_event, query: string) => client.search(query))
  ipcMain.handle('catalog:suggest', (_event, query: string) => client.suggest(query))

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

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('updates:check', () => updater.check())

  ipcMain.handle('updates:install', async () => {
    const appImage = await updater.install()
    // An AppImage runs an inner binary from its own read-only mount, so
    // process.execPath would be gone by the time the relaunch happens. Start
    // the file that was just replaced instead; Electron does that once this
    // instance has exited, which keeps the single-instance lock uncontended.
    app.relaunch({ execPath: appImage, args: relaunchArgs(process.argv.slice(1)) })
    app.quit()
  })
}
