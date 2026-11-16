// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, HomeData } from '@shared/types'
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
    rows: [{ title: 'Recently added', items: [card('a', 'Episode a'), card('b', 'Episode b')] }],
    ...overrides
  }
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

  it('shows a clean error from the main process', async () => {
    stubHome(Promise.reject(new Error("Error invoking remote method 'catalog:home': Error: Network down")))
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Network down')).toBeDefined()
  })

  it('shows the first featured card and the rows', async () => {
    stubHome(homeData())
    render(<Home onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Featured One' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeDefined()
    expect(focusFirst).toHaveBeenCalledWith('[data-focus]')
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

  it('refreshes the feed after playback without blanking it or moving focus', async () => {
    const before = homeData()
    const after = homeData({
      rows: [
        { title: 'Continue watching', items: [card('watched', 'Just Watched')] },
        { title: 'Recently added', items: [card('a', 'Episode a')] }
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
    expect(focusFirst).toHaveBeenCalledTimes(1)
  })
})
