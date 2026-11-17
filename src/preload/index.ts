import { contextBridge, ipcRenderer } from 'electron'
import type { BeaconApi, Card, FavouritesAnchor, NextEpisodeRequest, ProgressReport } from '@shared/types'

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
  favourites: {
    list: () => ipcRenderer.invoke('favourites:list'),
    add: (card: Card) => ipcRenderer.invoke('favourites:add', card),
    remove: (slug: string) => ipcRenderer.invoke('favourites:remove', slug),
    setPosition: (after: FavouritesAnchor) => ipcRenderer.invoke('favourites:setPosition', after)
  },
  playback: {
    open: (slug: string) => ipcRenderer.invoke('playback:open', slug),
    next: (request: NextEpisodeRequest) => ipcRenderer.invoke('playback:next', request),
    start: (contentId: string) => ipcRenderer.invoke('playback:start', contentId),
    progress: (report: ProgressReport) => ipcRenderer.invoke('playback:progress', report),
    flush: () => ipcRenderer.invoke('playback:flush'),
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
