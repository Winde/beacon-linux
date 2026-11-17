// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, FavouriteItem, HomeData } from '@shared/types'
import { HERO_WIDTH, preloadAll } from '../lib/images'
import { focusFirst } from '../nav/focus'
import { Home } from './Home'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))
vi.mock('../lib/images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/images')>()
  return { ...actual, preloadAll: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(preloadAll).mockClear()
  vi.mocked(focusFirst).mockClear()
})

function card(slug: string, title: string, overrides: Partial<Card> = {}): Card {
  return {
    kind: 'video',
    slug,
    title,
    subtitle: 'Campaign 1',
    image: `https://images.example/${slug}/format=auto`,
    image2x: `https://images.example/${slug}x/format=auto`,
    minutes: 55,
    ...overrides
  }
}

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    hero: [card('feat-1', 'Featured One'), card('feat-2', 'Featured Two')],
    rows: [
      {
        id: 'recent',
        kind: 'latest',
        title: 'Recently added',
        items: [card('a', 'Episode a'), card('b', 'Episode b')]
      }
    ],
    ...overrides
  }
}

function favourite(
  slug: string,
  title: string,
  overrides: Partial<FavouriteItem> = {}
): FavouriteItem {
  return {
    kind: 'series',
    id: `id-${slug}`,
    slug,
    title,
    image: null,
    image2x: null,
    count: 12,
    ...overrides
  }
}

function shelfTitles(): (string | null)[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
}

function stubHome(result: HomeData | Promise<HomeData>): ReturnType<typeof vi.fn> {
  const home = vi.fn(() => Promise.resolve(result))
  vi.stubGlobal('beacon', { catalog: { home } })
  return home
}

describe('Home', () => {
  it('shows the loader while the feed loads', () => {
    stubHome(new Promise<HomeData>(() => {}))
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading Beacon')).toBeDefined()
  })

  it('shows a feed fetched during sign-in without a loader', async () => {
    stubHome(new Promise<HomeData>(() => {}))
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} initial={homeData()} />)

    expect(screen.queryByText('Loading Beacon')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Featured One' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeDefined()
  })

  it('shows a clean error from the main process', async () => {
    stubHome(
      Promise.reject(new Error("Error invoking remote method 'catalog:home': Error: Network down"))
    )
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Network down')).toBeDefined()
  })

  it('keeps the cached feed on screen when its refresh fails', async () => {
    stubHome(Promise.reject(new Error('Network down')))
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} initial={homeData()} />)

    expect(await screen.findByText("Couldn't refresh — saved copy")).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Featured One' })).toBeDefined()
    expect(screen.queryByText('Network down')).toBeNull()
  })

  it('shows the first featured card and the rows', async () => {
    stubHome(homeData())
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Featured One' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeDefined()
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('[data-focus]'))
    expect(preloadAll).toHaveBeenCalledWith([
      `https://images.example/feat-1x/format=auto,width=${HERO_WIDTH}`,
      `https://images.example/feat-2x/format=auto,width=${HERO_WIDTH}`
    ])
  })

  it('previews the tile that takes focus', async () => {
    const data = homeData()
    stubHome(data)
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)
    await screen.findByRole('heading', { level: 1, name: 'Featured One' })

    fireEvent.focusIn(screen.getByText('Episode a').closest('button')!)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Episode a')
  })

  it('plays the focused preview from the hero', async () => {
    const data = homeData()
    const onPlay = vi.fn()
    stubHome(data)
    render(<Home onOpen={vi.fn()} onPlay={onPlay} />)
    await screen.findByRole('heading', { level: 1, name: 'Featured One' })

    fireEvent.focusIn(screen.getByText('Episode b').closest('button')!)
    fireEvent.click(screen.getByTestId('hero-play'))

    expect(onPlay).toHaveBeenCalledWith(data.rows[0].items[1])
  })

  it('opens the card selected in a row', async () => {
    const data = homeData()
    const onOpen = vi.fn()
    stubHome(data)
    render(<Home onOpen={onOpen} onPlay={vi.fn()} />)
    await screen.findByRole('heading', { level: 1, name: 'Featured One' })

    fireEvent.click(screen.getByText('Episode b'))

    expect(onOpen).toHaveBeenCalledWith(data.rows[0].items[1])
  })

  it('puts the favourites just below Continue watching', async () => {
    stubHome(
      homeData({
        rows: [
          {
            id: 'cw',
            kind: 'continue',
            title: 'Continue watching',
            items: [card('cw', 'Watching')]
          },
          { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
        ]
      })
    )
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} favourites={[favourite('w1', 'Saved One')]} />)

    expect(await screen.findByRole('heading', { name: 'Favourites' })).toBeDefined()
    expect(shelfTitles()).toEqual(['Continue watching', 'Favourites', 'Recently added'])
    expect(screen.getByText('Saved One')).toBeDefined()
  })

  it('puts the favourites first when there is nothing to continue', async () => {
    stubHome(
      homeData({
        rows: [
          { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
        ]
      })
    )
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} favourites={[favourite('w1', 'Saved One')]} />)

    await screen.findByRole('heading', { name: 'Favourites' })
    expect(shelfTitles()).toEqual(['Favourites', 'Recently added'])
  })

  it('remembers a favourites row the player moved to the end', async () => {
    stubHome(
      homeData({
        rows: [
          {
            id: 'cw',
            kind: 'continue',
            title: 'Continue watching',
            items: [card('cw', 'Watching')]
          },
          { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
        ]
      })
    )
    render(
      <Home
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        favourites={[favourite('w1', 'Saved One')]}
        favouritesAfter="recent"
      />
    )

    await screen.findByRole('heading', { name: 'Favourites' })
    expect(shelfTitles()).toEqual(['Continue watching', 'Recently added', 'Favourites'])
  })

  it('hides the row while there are no favourites', async () => {
    stubHome(homeData())
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} favourites={[]} />)

    await screen.findByRole('heading', { name: 'Recently added' })
    expect(screen.queryByRole('heading', { name: 'Favourites' })).toBeNull()
  })

  it('moves the favourites row with its own arrows', async () => {
    const onMoveFavourites = vi.fn()
    stubHome(
      homeData({
        rows: [
          {
            id: 'cw',
            kind: 'continue',
            title: 'Continue watching',
            items: [card('cw', 'Watching')]
          },
          { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
        ]
      })
    )
    render(
      <Home
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        favourites={[favourite('w1', 'Saved One')]}
        onMoveFavourites={onMoveFavourites}
      />
    )

    await screen.findByRole('heading', { name: 'Favourites' })

    fireEvent.click(screen.getByTestId('favourites-up'))
    expect(onMoveFavourites).toHaveBeenLastCalledWith('top')

    fireEvent.click(screen.getByTestId('favourites-down'))
    expect(onMoveFavourites).toHaveBeenLastCalledWith('recent')
  })

  it('disables the arrows at the ends of the shelves', async () => {
    stubHome(
      homeData({
        rows: [
          {
            id: 'cw',
            kind: 'continue',
            title: 'Continue watching',
            items: [card('cw', 'Watching')]
          },
          { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
        ]
      })
    )
    const { rerender } = render(
      <Home
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        favourites={[favourite('w1', 'Saved One')]}
        favouritesAfter="top"
        onMoveFavourites={vi.fn()}
      />
    )
    await screen.findByRole('heading', { name: 'Favourites' })

    expect(screen.getByTestId<HTMLButtonElement>('favourites-up').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('favourites-down').disabled).toBe(false)

    rerender(
      <Home
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        favourites={[favourite('w1', 'Saved One')]}
        favouritesAfter="recent"
        onMoveFavourites={vi.fn()}
      />
    )

    expect(screen.getByTestId<HTMLButtonElement>('favourites-up').disabled).toBe(false)
    expect(screen.getByTestId<HTMLButtonElement>('favourites-down').disabled).toBe(true)
  })

  it('favourites the previewed series from the hero, saved or not', async () => {
    const onToggleFavourite = vi.fn()
    stubHome(homeData())
    render(
      <Home
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        favourites={[favourite('w1', 'Saved One')]}
        onToggleFavourite={onToggleFavourite}
      />
    )
    await screen.findByRole('heading', { level: 1, name: 'Featured One' })
    // The featured card is an episode: there is nothing to favourite yet.
    expect(screen.queryByTestId('hero-favourite')).toBeNull()

    fireEvent.focusIn(screen.getByText('Saved One').closest('button')!)
    expect(screen.getByTestId('hero-favourite').textContent).toBe('Remove from favourites')

    fireEvent.click(screen.getByTestId('hero-favourite'))
    expect(onToggleFavourite).toHaveBeenCalledWith(expect.objectContaining({ slug: 'w1' }))
  })

  it('refreshes the feed after playback without blanking it or moving focus', async () => {
    const before = homeData()
    const after = homeData({
      rows: [
        {
          id: 'cw',
          kind: 'continue',
          title: 'Continue watching',
          items: [card('watched', 'Just Watched')]
        },
        { id: 'recent', kind: 'latest', title: 'Recently added', items: [card('a', 'Episode a')] }
      ]
    })
    const home = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    vi.stubGlobal('beacon', { catalog: { home } })

    const { rerender } = render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Recently added' })

    rerender(<Home onOpen={vi.fn()} onPlay={vi.fn()} refreshKey={1} />)
    // The feed the viewer is looking at stays up until the new one is ready.
    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeDefined()
    expect(screen.queryByText('Loading Beacon')).toBeNull()

    expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeDefined()
    expect(home).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledTimes(1))
  })
})
