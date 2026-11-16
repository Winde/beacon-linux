import { contextBridge, ipcRenderer } from 'electron'
import type { BeaconApi, Card, NextEpisodeRequest, ProgressReport } from '@shared/types'

const api: BeaconApi = {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    signIn: (email: string, password: string) => ipcRenderer.invoke('auth:signIn', email, password),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
    storage: () => ipcRenderer.invoke('auth:storage')
  },
  catalog: {
    home: () => ipcRenderer.invoke('catalog:home'),
    collection: (slug: string) => ipcRenderer.invoke('catalog:collection', slug),
    content: (slug: string) => ipcRenderer.invoke('catalog:content', slug),
    search: (query: string) => ipcRenderer.invoke('catalog:search', query),
    suggest: (query: string) => ipcRenderer.invoke('catalog:suggest', query),
    indexStatus: () => ipcRenderer.invoke('catalog:indexStatus')
  },
  watchlist: {
    list: () => ipcRenderer.invoke('watchlist:list'),
    add: (card: Card) => ipcRenderer.invoke('watchlist:add', card),
    remove: (kind: Card['kind'], slug: string) =>
      ipcRenderer.invoke('watchlist:remove', kind, slug),
    setPosition: (rowsAbove: number) => ipcRenderer.invoke('watchlist:setPosition', rowsAbove),
    clear: () => ipcRenderer.invoke('watchlist:clear')
  },
  playback: {
    open: (slug: string) => ipcRenderer.invoke('playback:open', slug),
    next: (request: NextEpisodeRequest) => ipcRenderer.invoke('playback:next', request),
    progress: (report: ProgressReport) => ipcRenderer.invoke('playback:progress', report),
    captions: (url: string) => ipcRenderer.invoke('playback:captions', url)
  },
  watch: {
    mark: (slug: string, watched: boolean) => ipcRenderer.invoke('watch:mark', slug, watched)
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    toggleFullscreen: () => ipcRenderer.invoke('app:toggleFullscreen'),
    platform: () => ipcRenderer.invoke('app:platform'),
    initialSlug: () => ipcRenderer.invoke('app:initialSlug')
  }
}

contextBridge.exposeInMainWorld('beacon', api)
