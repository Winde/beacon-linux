// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistItem } from '@shared/types'
import App from './App'

beforeEach(() => {
  // Focus navigation scrolls what it focuses; jsdom has no layout engine.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function saved(slug: string, title: string): WatchlistItem {
  return {
    kind: 'video',
    id: `id-${slug}`,
    slug,
    title,
    subtitle: 'Campaign 1',
    image: null,
    image2x: null,
    minutes: 55,
    count: null,
    addedAt: 1
  }
}

interface StubOptions {
  signedIn?: boolean
  items?: WatchlistItem[]
}

function stubApp({ signedIn = true, items = [] }: StubOptions = {}): {
  signOut: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
} {
  const signOut = vi.fn(() => Promise.resolve())
  const clear = vi.fn(() => Promise.resolve({ items: [], rowsAbove: null }))
  const list = vi.fn(() => Promise.resolve({ items, rowsAbove: null }))

  vi.stubGlobal('beacon', {
    auth: {
      status: vi.fn(() =>
        Promise.resolve({
          signedIn,
          user: signedIn ? { name: 'Member', tier: 'Apprentice', active: true } : null
        })
      ),
      signIn: vi.fn(),
      signOut,
      storage: vi.fn(() => Promise.resolve('keyring'))
    },
    catalog: {
      home: vi.fn(() => Promise.resolve({ hero: [], rows: [] })),
      collection: vi.fn(),
      content: vi.fn(),
      search: vi.fn(),
      suggest: vi.fn(),
      indexStatus: vi.fn()
    },
    watchlist: {
      list,
      add: vi.fn(),
      remove: vi.fn(),
      setPosition: vi.fn(),
      clear
    },
    playback: { open: vi.fn(), next: vi.fn(), progress: vi.fn(), captions: vi.fn() },
    watch: { mark: vi.fn() },
    app: {
      quit: vi.fn(),
      toggleFullscreen: vi.fn(),
      platform: vi.fn(() => Promise.resolve('linux')),
      initialSlug: vi.fn(() => Promise.resolve(null))
    }
  })

  return { signOut, clear, list }
}

describe('App sign out', () => {
  it('asks before deleting a non-empty watchlist', async () => {
    const { signOut, clear } = stubApp({ items: [saved('c1e1', 'Saved One')] })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))

    expect(screen.getByRole('dialog', { name: 'Delete your watchlist?' })).toBeDefined()
    expect(signOut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('keep-watchlist'))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(clear).not.toHaveBeenCalled()
  })

  it('deletes the list when that choice is made', async () => {
    const { signOut, clear } = stubApp({ items: [saved('c1e1', 'Saved One')] })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))
    fireEvent.click(screen.getByTestId('delete-watchlist'))

    await waitFor(() => expect(clear).toHaveBeenCalledOnce())
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0])
  })

  it('can cancel and stay signed in', async () => {
    const { signOut, clear } = stubApp({ items: [saved('c1e1', 'Saved One')] })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))
    fireEvent.click(screen.getByTestId('cancel-signout'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('signs out straight away when there is nothing to delete', async () => {
    const { signOut, clear } = stubApp()
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })

  it('does not touch the list when an invalid session signs the member out', async () => {
    const { clear, list } = stubApp({ signedIn: false })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
    await waitFor(() => expect(list).toHaveBeenCalledOnce())
    expect(clear).not.toHaveBeenCalled()
  })
})
