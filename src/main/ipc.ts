import { BrowserWindow, ipcMain } from 'electron'
import type { ProgressReport } from '@shared/types'
import { BeaconClient } from './beacon/client'
import { Catalog } from './beacon/catalog'
import { fetchCaptionFile, fetchMasterPlaylist } from './hls'

export const client = new BeaconClient()
export const catalog = new Catalog(client)
client.catalog = catalog

export function registerIpc(): void {
  ipcMain.handle('auth:status', () => client.status())
  ipcMain.handle('auth:signIn', (_event, email: string, password: string) =>
    client.signIn(email, password)
  )
  ipcMain.handle('auth:signOut', () => client.signOut())

  ipcMain.handle('catalog:home', () => client.home())
  ipcMain.handle('catalog:collection', (_event, slug: string) => client.collection(slug))
  ipcMain.handle('catalog:content', (_event, slug: string) => client.content(slug))
  ipcMain.handle('catalog:search', (_event, query: string) => client.search(query))
  ipcMain.handle('catalog:suggest', (_event, query: string) => client.suggest(query))
  ipcMain.handle('catalog:indexStatus', () => catalog.status())

  ipcMain.handle('playback:open', async (_event, slug: string) => {
    const data = await client.play(slug)
    if (!data) return null
    try {
      data.playlist = await fetchMasterPlaylist(data.url)
    } catch {
      // Serve the original playlist; the player still works, just starts softer.
      data.playlist = null
    }
    return data
  })

  ipcMain.handle('playback:progress', (_event, report: ProgressReport) =>
    client.trackProgress(report.contentId, report.position, report.duration)
  )

  ipcMain.handle('playback:captions', (_event, url: string) => fetchCaptionFile(url))

  ipcMain.handle('app:quit', () => {
    for (const window of BrowserWindow.getAllWindows()) window.close()
  })

  ipcMain.handle('app:toggleFullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.setFullScreen(!window.isFullScreen())
  })

  ipcMain.handle('app:platform', () => process.platform)
}
