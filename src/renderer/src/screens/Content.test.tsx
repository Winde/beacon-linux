// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentData } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { Content } from './Content'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function contentData(overrides: Partial<ContentData> = {}): ContentData {
  return {
    id: 'e5',
    slug: 'c1e5',
    title: 'Campaign 1 Episode 5',
    description: 'An episode.',
    continuedSummary: '',
    image: 'https://images.example/page/format=auto',
    image2x: 'https://images.example/wide/format=auto',
    minutes: 55,
    released: '2024-01-01T00:00:00.000Z',
    series: { slug: 'campaign-1', title: 'Campaign 1' },
    tier: 'Apprentice',
    locked: false,
    signInNeeded: false,
    signedIn: true,
    watched: false,
    resumeAt: 0,
    rows: [],
    ...overrides
  }
}

/** Replace the preload bridge with a catalog that answers content(). */
function stubContent(
  result: ContentData | Promise<ContentData>,
  mark = vi.fn(() => Promise.resolve({ watched: true, progress: 1 }))
): ReturnType<typeof vi.fn> {
  const content = vi.fn(() => Promise.resolve(result))
  vi.stubGlobal('beacon', { catalog: { content }, watch: { mark } })
  return content
}

describe('Content', () => {
  it('shows the loader while the episode loads', () => {
    stubContent(new Promise<ContentData>(() => {}))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading episode')).toBeDefined()
  })

  it('shows the episode details', async () => {
    const content = stubContent(contentData())
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Campaign 1 Episode 5')).toBeDefined()
    expect(screen.getByText('Campaign 1')).toBeDefined()
    expect(screen.getByText('55 min · Apprentice')).toBeDefined()
    expect(screen.getByText('An episode.')).toBeDefined()
    expect(content).toHaveBeenCalledWith('c1e5')
    expect(focusFirst).toHaveBeenCalledWith('[data-testid="play"]')
  })

  it('clamps the description and reveals the continued summary on See More', async () => {
    stubContent(
      contentData({
        description: '<p>A short intro.</p>',
        continuedSummary: '<p>Recorded live from Excalibur Con.</p><p>Credits here.</p>'
      })
    )
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    const intro = await screen.findByText('A short intro.')
    expect(intro.className).toContain('is-clamped')
    expect(screen.queryByText(/Credits here/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '...See More' }))

    expect(await screen.findByText(/Credits here/)).toBeDefined()
    expect(intro.className).not.toContain('is-clamped')

    fireEvent.click(screen.getByRole('button', { name: 'See Less' }))

    expect(screen.queryByText(/Credits here/)).toBeNull()
    expect(intro.className).toContain('is-clamped')
  })

  it('shows the full description without a toggle when there is nothing more', async () => {
    stubContent(contentData({ description: 'A whole episode in one line.' }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    const description = await screen.findByText('A whole episode in one line.')
    expect(description.className).not.toContain('is-clamped')
    expect(screen.queryByRole('button', { name: /See (More|Less)/ })).toBeNull()
  })

  it('strips markup out of the description', async () => {
    stubContent(contentData({ description: '<p>Hello <strong>world</strong></p>' }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Hello world')).toBeDefined()
  })

  it('offers Play for an unstarted video', async () => {
    const onPlay = vi.fn()
    stubContent(contentData())
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={onPlay} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }))

    expect(onPlay).toHaveBeenCalledWith('c1e5')
    expect(screen.queryByText('Start over')).toBeNull()
  })

  it('offers Resume and Start over for a started video', async () => {
    const onPlay = vi.fn()
    stubContent(contentData({ resumeAt: 120 }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={onPlay} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(onPlay).toHaveBeenCalledWith('c1e5')

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(onPlay).toHaveBeenLastCalledWith('c1e5', 0)
  })

  it('marks an episode watched and reports the change', async () => {
    const mark = vi.fn(() => Promise.resolve({ watched: true, progress: 1 }))
    const onWatchedChanged = vi.fn()
    stubContent(contentData(), mark)
    render(
      <Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} onWatchedChanged={onWatchedChanged} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Mark as watched' }))

    expect(await screen.findByRole('button', { name: 'Mark as unwatched' })).toBeDefined()
    expect(mark).toHaveBeenCalledWith('c1e5', true)
    expect(onWatchedChanged).toHaveBeenCalled()
  })

  it('takes a watched episode back to unwatched', async () => {
    const mark = vi.fn(() => Promise.resolve({ watched: false, progress: 0 }))
    stubContent(contentData({ watched: true }), mark)
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mark as unwatched' }))

    expect(await screen.findByRole('button', { name: 'Mark as watched' })).toBeDefined()
    expect(mark).toHaveBeenCalledWith('c1e5', false)
  })

  it('keeps the original label when a mark is rejected', async () => {
    const mark = vi.fn(() =>
      Promise.reject(new Error("Error invoking remote method 'watch:mark': Error: Offline."))
    )
    stubContent(contentData(), mark)
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mark as watched' }))

    expect(await screen.findByText('Offline.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Mark as watched' })).toBeDefined()
  })

  it('hides the watch control from guests', async () => {
    stubContent(contentData({ signedIn: false }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    await screen.findByRole('button', { name: 'Play' })
    expect(screen.queryByTestId('watch-toggle')).toBeNull()
  })

  it('explains that a locked video needs a sign-in', async () => {
    stubContent(contentData({ locked: true, signInNeeded: true }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Sign in with a Beacon account to watch this.')).toBeDefined()
    expect(screen.queryByTestId('play')).toBeNull()
  })

  it('explains that a locked video needs a higher tier', async () => {
    stubContent(contentData({ locked: true, signInNeeded: false }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(
      await screen.findByText('Your membership level does not include this video.')
    ).toBeDefined()
  })

  it('offers no favourite on an episode', async () => {
    stubContent(contentData())
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    await screen.findByText('Campaign 1 Episode 5')
    expect(screen.queryByRole('button', { name: /favourites?$/i })).toBeNull()
    expect(screen.queryByTestId('favourite-toggle')).toBeNull()
  })

  it('shows a clean error from the main process', async () => {
    stubContent(
      Promise.reject(new Error("Error invoking remote method 'catalog:content': Error: Video not found."))
    )
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Video not found.')).toBeDefined()
    expect(screen.queryByTestId('play')).toBeNull()
  })

  it('renders the attached rows', async () => {
    stubContent(
      contentData({
        rows: [
          {
            title: 'More from Campaign 1',
            items: [
              {
                kind: 'video',
                slug: 'c1e6',
                title: 'Campaign 1 Episode 6',
                image: null
              }
            ]
          }
        ]
      })
    )
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'More from Campaign 1' })).toBeDefined()
    expect(screen.getByRole('button', { name: /Campaign 1 Episode 6/ })).toBeDefined()
  })
})
