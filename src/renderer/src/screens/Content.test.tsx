// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentData } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { pageCache } from '../lib/pages'
import { Content } from './Content'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))

afterEach(() => {
  cleanup()
  pageCache.clear()
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
    series: { slug: 'campaign-1', title: 'Campaign 1', isSeries: true },
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
  result: ContentData | null | Promise<ContentData | null>,
  mark = vi.fn(() => Promise.resolve({ watched: true, progress: 1 }))
): ReturnType<typeof vi.fn> {
  const content = vi.fn(() => Promise.resolve(result))
  vi.stubGlobal('beacon', { catalog: { content }, watch: { mark } })
  return content
}

describe('Content', () => {
  it('shows the skeleton while the episode loads', () => {
    stubContent(new Promise<ContentData>(() => {}))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading episode')).toBeDefined()
  })

  it('paints a saved page before the request answers', () => {
    pageCache.rememberContent(contentData())
    stubContent(new Promise<ContentData>(() => {}))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(screen.getByText('Campaign 1 Episode 5')).toBeDefined()
    expect(screen.getByText('An episode.')).toBeDefined()
    expect(screen.queryByText('Loading episode')).toBeNull()
  })

  it('prefills the header from the tile that opened it', () => {
    stubContent(new Promise<ContentData>(() => {}))
    render(
      <Content
        slug="c1e5"
        card={{
          kind: 'video',
          slug: 'c1e5',
          title: 'The Waters Edge',
          subtitle: 'Campaign 1',
          image: null,
          image2x: null,
          minutes: 55
        }}
        onOpen={vi.fn()}
        onPlay={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'The Waters Edge' })).toBeDefined()
    expect(screen.getByText('Campaign 1')).toBeDefined()
    expect(screen.getByText('55 min')).toBeDefined()
    expect(screen.getByText('Loading episode')).toBeDefined()
  })

  it('drops a saved page the CMS no longer has', async () => {
    pageCache.rememberContent(contentData())
    stubContent(null)
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Video not found.')).toBeDefined()
    expect(pageCache.content('c1e5')).toBeNull()
  })

  it('shows the episode details', async () => {
    const content = stubContent(contentData())
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByText('Campaign 1 Episode 5')).toBeDefined()
    expect(screen.getByText('Campaign 1')).toBeDefined()
    expect(screen.getByText('55 min · Apprentice')).toBeDefined()
    expect(screen.getByText('An episode.')).toBeDefined()
    expect(content).toHaveBeenCalledWith('c1e5')
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('[data-testid="play"]'))
  })

  it('opens the series from the episode header', async () => {
    const onOpen = vi.fn()
    stubContent(contentData())
    render(<Content slug="c1e5" onOpen={onOpen} onPlay={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Campaign 1' }))

    expect(onOpen).toHaveBeenCalledWith({
      kind: 'series',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: null,
      image2x: null
    })
  })

  it('uses the app’s up navigation when it is available', async () => {
    const onOpen = vi.fn()
    const onOpenSeries = vi.fn()
    stubContent(contentData())
    render(<Content slug="c1e5" onOpen={onOpen} onOpenSeries={onOpenSeries} onPlay={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'View series' }))

    expect(onOpenSeries).toHaveBeenCalledWith('campaign-1', {
      kind: 'series',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: null,
      image2x: null
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers an explicit View series action as well as the header link', async () => {
    const onOpen = vi.fn()
    stubContent(contentData())
    render(<Content slug="c1e5" onOpen={onOpen} onPlay={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'View series' }))

    expect(onOpen).toHaveBeenCalledWith({
      kind: 'series',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: null,
      image2x: null
    })
  })

  it('calls a non-series collection a collection', async () => {
    stubContent(
      contentData({
        series: { slug: 'previously-on', title: 'Previously On...', isSeries: false }
      })
    )
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'View collection' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'View series' })).toBeNull()
  })

  it('has no series link when the video is filed nowhere', async () => {
    stubContent(contentData({ series: null }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} />)

    await screen.findByText('Campaign 1 Episode 5')
    expect(screen.queryByTestId('series-link')).toBeNull()
    expect(screen.queryByTestId('open-series')).toBeNull()
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

  it('offers sign-in for a locked video', async () => {
    const onSignIn = vi.fn()
    stubContent(contentData({ locked: true, signInNeeded: true }))
    render(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} onSignIn={onSignIn} />)

    expect(await screen.findByText('Sign in with a Beacon account to watch this.')).toBeDefined()
    expect(screen.queryByTestId('play')).toBeNull()
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('[data-testid="signin"]'))

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalled()
  })

  it('moves focus to Play when a locked page is unlocked', async () => {
    const content = vi
      .fn()
      .mockResolvedValueOnce(contentData({ locked: true, signInNeeded: false }))
      .mockResolvedValueOnce(contentData({ locked: false }))
    vi.stubGlobal('beacon', { catalog: { content }, watch: { mark: vi.fn() } })
    const { rerender } = render(
      <Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} refreshKey={0} />
    )
    expect(
      await screen.findByText('Your membership level does not include this video.')
    ).toBeDefined()
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('[data-focus]'))

    vi.mocked(focusFirst).mockClear()
    rerender(<Content slug="c1e5" onOpen={vi.fn()} onPlay={vi.fn()} refreshKey={1} />)

    expect(await screen.findByTestId('play')).toBeDefined()
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('[data-testid="play"]'))
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
      Promise.reject(
        new Error("Error invoking remote method 'catalog:content': Error: Video not found.")
      )
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
