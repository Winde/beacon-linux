// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  homeImpl?: () => Promise<HomeData>
  add?: (card: Card) => Promise<FavouritesData>
  remove?: (slug: string) => Promise<FavouritesData>
}

function stubApp({
  signedIn = true,
  items = [],
  home = { hero: [], rows: [] },
  homeImpl,
  add,
  remove: removeImpl
}: StubOptions = {}): {
  signOut: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  home: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
} {
  const signOut = vi.fn(() => Promise.resolve())
  const list = vi.fn(() => Promise.resolve({ items, after: null }))
  const homeFn = vi.fn(homeImpl ?? (() => Promise.resolve(home)))
  const addFn = vi.fn(add ?? (() => Promise.resolve({ items, after: null })))
  const remove = vi.fn(removeImpl ?? (() => Promise.resolve({ items: [], after: null })))
  const quit = vi.fn()

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
      home: homeFn,
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
      quit,
      toggleFullscreen: vi.fn(),
      platform: vi.fn(() => Promise.resolve('linux')),
      initialSlug: vi.fn(() => Promise.resolve(null))
    }
  })

  return { signOut, list, home: homeFn, add: addFn, remove, quit }
}

describe('App sign out', () => {
  it('asks before dropping the session', async () => {
    const { signOut, list, remove } = stubApp({ items: [favourite('campaign-1', 'Campaign 1')] })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))

    const dialog = await screen.findByRole('dialog', { name: 'Sign out?' })
    expect(dialog).toBeDefined()
    expect(signOut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-signout'))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
    // Signed out, the list is read again and comes back empty.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('can cancel and stay signed in', async () => {
    const { signOut } = stubApp()
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))
    fireEvent.click(screen.getByTestId('cancel-signout'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('takes Back as cancel', async () => {
    const { signOut } = stubApp()
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-signout'))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
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

describe('App back', () => {
  it('exits when Back is pressed on the first screen', async () => {
    const { quit } = stubApp({ home: HOME_WITH_SERIES })
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(quit).toHaveBeenCalledOnce()
  })

  it('goes back a screen before it offers to exit', async () => {
    const { quit } = stubApp({ home: HOME_WITH_SERIES })
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })
    fireEvent.keyDown(window, { key: '/' })
    await screen.findByRole('heading', { level: 1, name: 'Search' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('heading', { level: 1, name: 'Search' })).toBeNull()
    expect(quit).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(quit).toHaveBeenCalledOnce()
  })
})

describe('App sign-in', () => {
  it('keeps the form up until the first feed is ready', async () => {
    let deliver!: (feed: HomeData) => void
    const { home } = stubApp({
      signedIn: false,
      homeImpl: () =>
        new Promise<HomeData>((resolve) => {
          deliver = resolve
        })
    })
    render(<App />)

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'member@example.com' }
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    await waitFor(() => expect(home).toHaveBeenCalledOnce())
    // No blank screen and no second spinner: the form waits for the feed.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined()
    expect(screen.queryByText('Loading Beacon')).toBeNull()

    await act(async () => deliver(HOME_WITH_SERIES))

    expect(await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
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
