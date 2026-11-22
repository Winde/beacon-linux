// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthStatus,
  CachedPages,
  Card,
  CollectionData,
  ContentData,
  FavouriteItem,
  FavouritesData,
  HomeData,
  ReleaseNote,
  UpdateInfo
} from '@shared/types'
import App, { upToCollection, type Entry } from './App'
import { setFocused } from './nav/focus'
import { featureFlags } from './lib/featureFlags'
import { pageCache } from './lib/pages'

beforeEach(() => {
  // Focus navigation scrolls what it focuses; jsdom has no layout engine.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  pageCache.clear()
  featureFlags.pageTransitions = true
  featureFlags.focusDepth = true
  featureFlags.rowPivot = true
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'startViewTransition')
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

const VIDEO: Card = {
  kind: 'video',
  id: 'id-video-1',
  slug: 'video-1',
  title: 'Episode 1',
  image: null,
  image2x: null,
  minutes: 30
}

const COLLECTION: CollectionData = {
  id: 'id-campaign-1',
  slug: 'campaign-1',
  title: 'Campaign 1',
  image: null,
  image2x: null,
  isSeries: true,
  seasons: [{ title: 'Season 1', items: [VIDEO] }]
}

const HOME_WITH_SERIES: HomeData = {
  hero: [],
  rows: [{ id: 'featured', kind: 'featured', title: 'Featured', items: [SERIES] }]
}

const HOME_WITH_VIDEO: HomeData = {
  hero: [],
  rows: [{ id: 'latest', kind: 'latest', title: 'Latest', items: [VIDEO] }]
}

const EPISODE: ContentData = {
  id: 'e5',
  slug: 'c1e5',
  title: 'Campaign 1 Episode 5',
  description: 'An episode.',
  continuedSummary: '',
  image: null,
  image2x: null,
  minutes: 55,
  released: null,
  kind: 'video',
  livestream: false,
  live: false,
  series: { slug: 'campaign-1', title: 'Campaign 1', isSeries: true },
  tier: 'Apprentice',
  locked: false,
  signInNeeded: false,
  signedIn: true,
  watched: false,
  resumeAt: 0,
  rows: []
}

const NO_PAGES: CachedPages = { collections: [], contents: [] }

interface StubOptions {
  signedIn?: boolean
  items?: FavouriteItem[]
  home?: HomeData
  homeImpl?: () => Promise<HomeData>
  add?: (card: Card) => Promise<FavouritesData>
  remove?: (slug: string) => Promise<FavouritesData>
  listImpl?: () => Promise<FavouritesData>
  version?: string
  check?: () => Promise<UpdateInfo>
  notes?: () => Promise<ReleaseNote[]>
  install?: () => Promise<void>
  initialSlug?: string | null
  cachedHome?: HomeData | null
  cachedFavourites?: FavouritesData | null
  cachedPages?: CachedPages
  status?: () => Promise<AuthStatus>
}

function stubApp({
  signedIn = true,
  items = [],
  home = { hero: [], rows: [] },
  homeImpl,
  add,
  remove: removeImpl,
  listImpl,
  version = '0.1.4',
  check,
  notes,
  install,
  initialSlug = null,
  cachedHome = null,
  cachedFavourites = null,
  cachedPages = NO_PAGES,
  status
}: StubOptions = {}): {
  signOut: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  home: ReturnType<typeof vi.fn>
  content: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
  check: ReturnType<typeof vi.fn>
  notes: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
} {
  const signOut = vi.fn(() => Promise.resolve())
  const list = vi.fn(listImpl ?? (() => Promise.resolve({ items, after: null })))
  const homeFn = vi.fn(homeImpl ?? (() => Promise.resolve(home)))
  const addFn = vi.fn(add ?? (() => Promise.resolve({ items, after: null })))
  const remove = vi.fn(removeImpl ?? (() => Promise.resolve({ items: [], after: null })))
  const content = vi.fn(() => Promise.resolve(EPISODE))
  const quit = vi.fn()
  const checkFn = vi.fn(
    check ??
      (() =>
        Promise.resolve<UpdateInfo>({
          current: version,
          latest: version,
          available: false,
          canInstall: true
        }))
  )
  const installFn = vi.fn(install ?? (() => Promise.resolve()))
  const notesFn = vi.fn(notes ?? (() => Promise.resolve<ReleaseNote[]>([])))

  vi.stubGlobal('beacon', {
    auth: {
      session: vi.fn(() =>
        Promise.resolve({ signedIn, email: signedIn ? 'member@example.com' : null })
      ),
      status: vi.fn(
        status ??
          (() =>
            Promise.resolve({
              signedIn,
              user: signedIn ? { name: 'Member', tier: 'Apprentice', active: true } : null
            }))
      ),
      signIn: vi.fn(),
      signOut,
      storage: vi.fn(() => Promise.resolve('keyring'))
    },
    catalog: {
      home: homeFn,
      cachedHome: vi.fn(() => Promise.resolve(cachedHome)),
      cachedPages: vi.fn(() => Promise.resolve(cachedPages)),
      browse: vi.fn(),
      collection: vi.fn(() => Promise.resolve(COLLECTION)),
      content,
      search: vi.fn(),
      suggest: vi.fn()
    },
    favourites: {
      cached: vi.fn(() => Promise.resolve(cachedFavourites)),
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
      initialSlug: vi.fn(() => Promise.resolve(initialSlug)),
      version: vi.fn(() => Promise.resolve(version))
    },
    updates: { check: checkFn, notes: notesFn, install: installFn }
  })

  return {
    signOut,
    list,
    home: homeFn,
    content,
    add: addFn,
    remove,
    quit,
    check: checkFn,
    notes: notesFn,
    install: installFn
  }
}

describe('App sign out', () => {
  it('asks before dropping the session', async () => {
    pageCache.load({ collections: [], contents: [EPISODE] })
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
    // The signed-out screen must not keep the previous account's pages.
    expect(pageCache.content('c1e5')).toBeNull()
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

  it('fills the page cache before the first route renders', async () => {
    stubApp({ cachedPages: { collections: [], contents: [EPISODE] } })
    render(<App />)

    await waitFor(() => expect(pageCache.content('c1e5')).not.toBeNull())
  })

  it('opens a deep-linked episode over Home', async () => {
    const { content } = stubApp({ initialSlug: 'c1e1' })
    render(<App />)

    await waitFor(() => expect(content).toHaveBeenCalledWith('c1e1'))
  })

  it('shows sign-in when there is no session', async () => {
    stubApp({ signedIn: false })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  })
})

describe('App startup', () => {
  it('paints the cached feed without waiting for the account check', async () => {
    const { home } = stubApp({
      cachedHome: HOME_WITH_SERIES,
      homeImpl: () => new Promise<HomeData>(() => {}),
      status: () => new Promise<AuthStatus>(() => {})
    })
    render(<App />)

    // The local boot is long over before the delayed spinner would appear.
    expect(screen.queryByText('Loading Beacon')).toBeNull()
    expect(await screen.findByRole('button', { name: /Campaign 1/ })).toBeDefined()
    expect(screen.queryByText('Loading Beacon')).toBeNull()
    // A cache hit is never treated as fresh: the feed is revalidated anyway.
    // The revalidation starts in a passive effect, after the cached paint.
    await waitFor(() => expect(home).toHaveBeenCalledOnce())
  })

  it('paints the cached Favourites row with the feed', async () => {
    stubApp({
      cachedHome: HOME_WITH_SERIES,
      cachedFavourites: { items: [favourite('campaign-1', 'Campaign 1')], after: null },
      homeImpl: () => new Promise<HomeData>(() => {}),
      status: () => new Promise<AuthStatus>(() => {}),
      listImpl: () => new Promise<FavouritesData>(() => {})
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Favourites' })).toBeDefined()
    // One tile from the feed, one from the cached favourites row.
    expect(screen.getAllByRole('button', { name: /Campaign 1/ })).toHaveLength(2)
  })

  it('replaces a cached Favourites row when the account has moved on', async () => {
    let release!: (data: FavouritesData) => void
    const live = new Promise<FavouritesData>((resolve) => {
      release = resolve
    })
    stubApp({
      cachedHome: HOME_WITH_SERIES,
      cachedFavourites: { items: [favourite('old', 'Old Favourite')], after: null },
      homeImpl: () => new Promise<HomeData>(() => {}),
      status: () => new Promise<AuthStatus>(() => {}),
      listImpl: () => live
    })
    render(<App />)

    expect(await screen.findByText('Old Favourite')).toBeDefined()

    act(() => release({ items: [favourite('new', 'New Favourite')], after: null }))

    expect(await screen.findByText('New Favourite')).toBeDefined()
    expect(screen.queryByText('Old Favourite')).toBeNull()
  })

  it('does not duplicate the boot favourites read on focus', async () => {
    let release!: (data: FavouritesData) => void
    const live = new Promise<FavouritesData>((resolve) => {
      release = resolve
    })
    const { list } = stubApp({
      cachedHome: HOME_WITH_SERIES,
      homeImpl: () => new Promise<HomeData>(() => {}),
      listImpl: () => live
    })
    render(<App />)
    await screen.findByRole('button', { name: /Campaign 1/ })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(list).toHaveBeenCalledOnce()

    await act(async () => {
      release({ items: [], after: null })
    })

    // The read just landed; a second focus is inside the cooldown.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(list).toHaveBeenCalledOnce()
  })

  it('falls back to sign-in when the stored session is rejected', async () => {
    stubApp({
      cachedHome: HOME_WITH_SERIES,
      homeImpl: () => new Promise<HomeData>(() => {}),
      status: () => Promise.resolve({ signedIn: false, user: null })
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  })
})

describe('App updates', () => {
  const UP_TO_DATE: UpdateInfo = {
    current: '0.1.4',
    latest: '0.1.4',
    available: false,
    canInstall: true
  }
  const NEWER: UpdateInfo = {
    current: '0.1.4',
    latest: '0.2.0',
    available: true,
    canInstall: true
  }

  it('puts the running version in the rail', async () => {
    stubApp({ version: '0.3.1' })
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('rail-version').textContent).toBe('v0.3.1'))
  })

  it('says when there is nothing newer', async () => {
    stubApp({ check: () => Promise.resolve(UP_TO_DATE) })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))

    const dialog = await screen.findByRole('dialog', { name: "You're up to date" })
    expect(dialog.textContent).toContain('v0.1.4')

    fireEvent.click(screen.getByTestId('update-close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the newer release and installs it', async () => {
    let finish!: () => void
    const { install } = stubApp({
      check: () => Promise.resolve(NEWER),
      install: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))
    await screen.findByRole('dialog', { name: 'Beacon v0.2.0 is available' })

    fireEvent.click(screen.getByTestId('update-install'))
    expect(install).toHaveBeenCalledOnce()
    expect(screen.getByText(/Downloading Beacon v0\.2\.0/)).toBeDefined()

    await act(async () => finish())

    expect(await screen.findByText(/is installed\. Closing Beacon/)).toBeDefined()
    expect(await screen.findByText(/open it again from Steam/)).toBeDefined()
  })

  it('lists the notes of every release between the running one and the offered one', async () => {
    const { notes } = stubApp({
      check: () => Promise.resolve(NEWER),
      notes: () =>
        Promise.resolve([
          { version: '0.2.0', notes: 'Player changes.' },
          { version: '0.1.5', notes: 'Caption fix.' }
        ])
    })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))
    await screen.findByRole('dialog', { name: 'Beacon v0.2.0 is available' })

    expect(await screen.findByRole('heading', { name: 'v0.2.0' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'v0.1.5' })).toBeDefined()
    expect(screen.getByText('Player changes.')).toBeDefined()
    expect(screen.getByText('Caption fix.')).toBeDefined()
    expect(notes).toHaveBeenCalledOnce()
  })

  it('still installs when the release notes cannot be loaded', async () => {
    const { install } = stubApp({
      check: () => Promise.resolve(NEWER),
      notes: () => Promise.reject(new Error('offline'))
    })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))
    await screen.findByRole('dialog', { name: 'Beacon v0.2.0 is available' })

    expect(await screen.findByText(/Release notes couldn't be loaded/)).toBeDefined()
    fireEvent.click(screen.getByTestId('update-install'))
    expect(install).toHaveBeenCalledOnce()
  })

  it('keeps offering the release after Later', async () => {
    stubApp({ check: () => Promise.resolve(NEWER) })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))
    await screen.findByRole('dialog', { name: 'Beacon v0.2.0 is available' })
    fireEvent.click(screen.getByTestId('update-later'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('rail-update').textContent).toContain('Update to v0.2.0')
  })

  it('reports a failed check and tries again', async () => {
    const { check } = stubApp({
      check: () => Promise.reject(new Error('Could not reach GitHub.'))
    })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))
    const dialog = await screen.findByRole('dialog', { name: "Couldn't check for updates" })
    expect(dialog.textContent).toContain('Could not reach GitHub.')

    fireEvent.click(screen.getByTestId('update-retry'))
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
  })

  it('points a copy that cannot update itself at the release page', async () => {
    stubApp({ check: () => Promise.resolve({ ...NEWER, canInstall: false }) })
    render(<App />)

    fireEvent.click(await screen.findByTestId('rail-update'))

    const dialog = await screen.findByRole('dialog', { name: 'Beacon v0.2.0 is available' })
    expect(dialog.textContent).toContain("can't replace itself")
    expect(screen.queryByTestId('update-install')).toBeNull()
  })
})

describe('App up navigation', () => {
  it('pops back to a collection already in the stack', () => {
    const stack: Entry[] = [
      { id: 0, route: { name: 'home' } },
      { id: 1, route: { name: 'collection', slug: 'campaign-1' } },
      { id: 2, route: { name: 'content', slug: 'c1e1' } }
    ]

    expect(upToCollection(stack, 'campaign-1', () => 99)).toEqual(stack.slice(0, 2))
  })

  it('pushes an episode’s collection when it is not in history yet', () => {
    const stack: Entry[] = [
      { id: 0, route: { name: 'search' } },
      { id: 1, route: { name: 'content', slug: 'c1e1' } }
    ]

    expect(upToCollection(stack, 'previously-on', () => 99)).toEqual([
      { id: 0, route: { name: 'search' } },
      { id: 1, route: { name: 'content', slug: 'c1e1' } },
      { id: 99, route: { name: 'collection', slug: 'previously-on' } }
    ])
  })

  it('keeps the episode when an older copy of the series is buried by search', () => {
    const stack: Entry[] = [
      { id: 0, route: { name: 'home' } },
      { id: 1, route: { name: 'collection', slug: 'campaign-1' } },
      { id: 2, route: { name: 'search' } },
      { id: 3, route: { name: 'content', slug: 'c1e1' } }
    ]

    expect(upToCollection(stack, 'campaign-1', () => 99)).toEqual([
      { id: 0, route: { name: 'home' } },
      { id: 2, route: { name: 'search' } },
      { id: 3, route: { name: 'content', slug: 'c1e1' } },
      { id: 99, route: { name: 'collection', slug: 'campaign-1' } }
    ])
  })
})

describe('App back', () => {
  it('exits when Back is pressed on the first screen', async () => {
    const { quit } = stubApp({ home: HOME_WITH_SERIES })
    render(<App />)

    await screen.findByRole('button', { name: /Campaign 1/ })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(quit).toHaveBeenCalledOnce()
  })

  it('puts the highlight back on the tile that opened the page', async () => {
    stubApp({ home: HOME_WITH_VIDEO })
    render(<App />)

    const tile = await screen.findByRole('button', { name: /Episode 1/ })
    setFocused(tile)
    fireEvent.click(tile)

    // jsdom has no layout engine, so the page's own focusFirst() skips every
    // candidate. Stand in for it: the real app focuses Play on arrival.
    const play = await screen.findByTestId('play')
    setFocused(play)

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(tile))
    expect(tile.classList.contains('is-focused')).toBe(true)
  })

  it('keeps the tile focus when the page behind it painted from cache', async () => {
    const home: HomeData = {
      hero: [],
      rows: [
        { id: 'latest', kind: 'latest', title: 'Latest', items: [{ ...VIDEO, slug: EPISODE.slug }] }
      ]
    }
    stubApp({ home, cachedPages: { collections: [], contents: [EPISODE] } })
    render(<App />)

    const tile = await screen.findByRole('button', { name: /Episode 1/ })
    setFocused(tile)
    fireEvent.click(tile)
    await screen.findByTestId('play')

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(tile))
    expect(tile.classList.contains('is-focused')).toBe(true)
  })

  it('carries the focused tile through a page transition', async () => {
    let sourceNames: string[] = []
    const start = vi.fn((callback: () => void) => {
      sourceNames = Array.from(document.querySelectorAll<HTMLElement>('[data-view-art]')).map(
        (element) => element.className
      )
      callback()
      return { finished: Promise.resolve() }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: start
    })

    stubApp({ home: HOME_WITH_VIDEO })
    render(<App />)

    const tile = await screen.findByRole('button', { name: /Episode 1/ })
    setFocused(tile)
    fireEvent.click(tile)

    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(sourceNames).toEqual(['tile__art'])
    await waitFor(() => expect(document.querySelector('[data-view-art]')).toBeNull())
  })

  it('leaves the extra focus depth off when its flag is off', async () => {
    featureFlags.focusDepth = false
    stubApp({ home: HOME_WITH_VIDEO })
    render(<App />)

    await screen.findByRole('button', { name: /Episode 1/ })

    expect(document.querySelector('.app')?.classList.contains('app--focus-depth')).toBe(false)
  })

  it('skips the page transition when the feature flag is off', async () => {
    featureFlags.pageTransitions = false
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: start
    })

    stubApp({ home: HOME_WITH_VIDEO })
    render(<App />)

    const tile = await screen.findByRole('button', { name: /Episode 1/ })
    setFocused(tile)
    fireEvent.click(tile)

    await screen.findByTestId('play')
    expect(start).not.toHaveBeenCalled()
  })

  it('goes back a screen before it offers to exit', async () => {
    const { quit } = stubApp({ home: HOME_WITH_SERIES })
    render(<App />)

    await screen.findByRole('button', { name: /Campaign 1/ })
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

    expect(await screen.findByRole('button', { name: /Campaign 1/ })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })
})

describe('App favourites', () => {
  /** Open the series from Home; its favourite control lives on the page head. */
  async function openCollection(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: /Campaign 1/ }))
    return screen.findByTestId('favourite-toggle')
  }

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

    const button = await openCollection()
    expect(button.textContent).toBe('Add to favourites')

    fireEvent.click(button)

    // The label is the new state immediately, with a spinner in place of the icon.
    expect(screen.getByTestId('favourite-toggle').textContent).toBe('Remove from favourites')
    expect(screen.getByTestId('favourite-toggle').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('favourite-toggle').querySelector('.button__spinner')).not.toBeNull()
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'series', slug: 'campaign-1', title: 'Campaign 1' })
    )

    settle({ items: [favourite('campaign-1', 'Campaign 1')], after: null })

    await waitFor(() =>
      expect(screen.getByTestId('favourite-toggle').getAttribute('aria-busy')).toBe('false')
    )
    expect(screen.getByTestId('favourite-toggle').querySelector('.button__spinner')).toBeNull()
    expect(screen.getByTestId('favourite-toggle').textContent).toBe('Remove from favourites')
  })

  it('puts the button back when the account refuses the write', async () => {
    const { add } = stubApp({
      home: HOME_WITH_SERIES,
      add: () => Promise.reject(new Error('You must be logged in.'))
    })
    render(<App />)

    const button = await openCollection()
    fireEvent.click(button)
    expect(screen.getByTestId('favourite-toggle').textContent).toBe('Remove from favourites')

    await waitFor(() =>
      expect(screen.getByTestId('favourite-toggle').textContent).toBe('Add to favourites')
    )
    expect(add).toHaveBeenCalledOnce()
    expect(screen.getByTestId('favourite-toggle').getAttribute('aria-busy')).toBe('false')
  })

  it('removes a favourite at once and spins while storing that', async () => {
    let settle!: (data: FavouritesData) => void
    const { remove } = stubApp({
      home: HOME_WITH_SERIES,
      items: [favourite('campaign-1', 'Saved Campaign')],
      remove: () =>
        new Promise<FavouritesData>((resolve) => {
          settle = resolve
        })
    })
    render(<App />)

    const button = await openCollection()
    expect(button.textContent).toBe('Remove from favourites')

    fireEvent.click(button)

    expect(screen.getByTestId('favourite-toggle').textContent).toBe('Add to favourites')
    expect(screen.getByTestId('favourite-toggle').getAttribute('aria-busy')).toBe('true')
    expect(remove).toHaveBeenCalledWith('campaign-1')

    settle({ items: [], after: null })
    await waitFor(() =>
      expect(screen.getByTestId('favourite-toggle').getAttribute('aria-busy')).toBe('false')
    )
  })
})
