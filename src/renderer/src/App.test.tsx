// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, FavouriteItem, FavouritesData, HomeData } from '@shared/types'
import App from './App'

beforeEach(() => {
  // Focus navigation scrolls what it focuses; jsdom has no layout engine.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function favourite(slug: string, title: string): FavouriteItem {
  return {
    kind: 'series',
    id: `id-${slug}`,
    slug,
    title,
    image: null,
    image2x: null,
    count: 12
  }
}

const SERIES: Card = {
  kind: 'series',
  id: 'id-campaign-1',
  slug: 'campaign-1',
  title: 'Campaign 1',
  image: null,
  image2x: null,
  count: 12
}

const HOME_WITH_SERIES: HomeData = { hero: [SERIES], rows: [] }

interface StubOptions {
  signedIn?: boolean
  items?: FavouriteItem[]
  home?: HomeData
  add?: (card: Card) => Promise<FavouritesData>
  remove?: (slug: string) => Promise<FavouritesData>
}

function stubApp({
  signedIn = true,
  items = [],
  home = { hero: [], rows: [] },
  add,
  remove: removeImpl
}: StubOptions = {}): {
  signOut: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  const signOut = vi.fn(() => Promise.resolve())
  const list = vi.fn(() => Promise.resolve({ items, after: null }))
  const addFn = vi.fn(add ?? (() => Promise.resolve({ items, after: null })))
  const remove = vi.fn(removeImpl ?? (() => Promise.resolve({ items: [], after: null })))

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
      home: vi.fn(() => Promise.resolve(home)),
      collection: vi.fn(),
      content: vi.fn(),
      search: vi.fn(),
      suggest: vi.fn(),
      indexStatus: vi.fn()
    },
    favourites: {
      list,
      add: addFn,
      remove,
      setPosition: vi.fn()
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

  return { signOut, list, add: addFn, remove }
}

describe('App sign out', () => {
  it('signs out without asking, since favourites are not stored here', async () => {
    const { signOut, list, remove } = stubApp({ items: [favourite('campaign-1', 'Campaign 1')] })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
    // Signed out, the list is read again and comes back empty.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('asks the account for its favourites on boot', async () => {
    const { list } = stubApp({ items: [favourite('campaign-1', 'Campaign 1')] })
    render(<App />)

    await waitFor(() => expect(list).toHaveBeenCalledOnce())
  })

  it('shows sign-in when there is no session', async () => {
    stubApp({ signedIn: false })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  })
})

describe('App favourites', () => {
  it('flips the button at once and spins until the account answers', async () => {
    let settle!: (data: FavouritesData) => void
    const { add } = stubApp({
      home: HOME_WITH_SERIES,
      add: () =>
        new Promise<FavouritesData>((resolve) => {
          settle = resolve
        })
    })
    render(<App />)

    const button = await screen.findByTestId('hero-favourite')
    expect(button.textContent).toBe('Add to favourites')

    fireEvent.click(button)

    // The label is the new state immediately, with a spinner in place of the icon.
    expect(screen.getByTestId('hero-favourite').textContent).toBe('Remove from favourites')
    expect(screen.getByTestId('hero-favourite').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('hero-favourite').querySelector('.button__spinner')).not.toBeNull()
    expect(add).toHaveBeenCalledWith(SERIES)

    settle({ items: [favourite('campaign-1', 'Campaign 1')], after: null })

    await waitFor(() =>
      expect(screen.getByTestId('hero-favourite').getAttribute('aria-busy')).toBe('false')
    )
    expect(screen.getByTestId('hero-favourite').querySelector('.button__spinner')).toBeNull()
    expect(screen.getByTestId('hero-favourite').textContent).toBe('Remove from favourites')
  })

  it('puts the button back when the account refuses the write', async () => {
    const { add } = stubApp({
      home: HOME_WITH_SERIES,
      add: () => Promise.reject(new Error('You must be logged in.'))
    })
    render(<App />)

    const button = await screen.findByTestId('hero-favourite')
    fireEvent.click(button)
    expect(screen.getByTestId('hero-favourite').textContent).toBe('Remove from favourites')

    await waitFor(() => expect(screen.getByTestId('hero-favourite').textContent).toBe('Add to favourites'))
    expect(add).toHaveBeenCalledOnce()
    expect(screen.getByTestId('hero-favourite').getAttribute('aria-busy')).toBe('false')
  })

  it('removes a favourite at once and spins while storing that', async () => {
    let settle!: (data: FavouritesData) => void
    const { remove } = stubApp({
      home: HOME_WITH_SERIES,
      items: [favourite('campaign-1', 'Campaign 1')],
      remove: () =>
        new Promise<FavouritesData>((resolve) => {
          settle = resolve
        })
    })
    render(<App />)

    const button = await screen.findByTestId('hero-favourite')
    expect(button.textContent).toBe('Remove from favourites')

    fireEvent.click(button)

    expect(screen.getByTestId('hero-favourite').textContent).toBe('Add to favourites')
    expect(screen.getByTestId('hero-favourite').getAttribute('aria-busy')).toBe('true')
    expect(remove).toHaveBeenCalledWith('campaign-1')

    settle({ items: [], after: null })
    await waitFor(() =>
      expect(screen.getByTestId('hero-favourite').getAttribute('aria-busy')).toBe('false')
    )
  })
})
