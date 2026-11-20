// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowseData, Card } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { Browse } from './Browse'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(focusFirst).mockClear()
})

function card(slug: string, title: string, released: string | null = null): Card {
  return {
    kind: 'series',
    id: slug,
    slug,
    title,
    image: `https://images.example/${slug}/format=auto`,
    image2x: null,
    count: 12,
    released
  }
}

const DATA: BrowseData = {
  series: [card('campaign-4', 'Campaign 4')],
  collections: [card('previously-on', 'Previously On...')]
}

function stubBrowse(result: BrowseData | Promise<BrowseData>): ReturnType<typeof vi.fn> {
  const browse = vi.fn(() => Promise.resolve(result))
  vi.stubGlobal('beacon', { catalog: { browse } })
  return browse
}

describe('Browse', () => {
  it('shows the loader while the catalog is read', () => {
    stubBrowse(new Promise<BrowseData>(() => {}))
    render(<Browse onOpen={vi.fn()} />)

    expect(screen.getByText('Loading series and collections')).toBeDefined()
  })

  it('lists every series and opens one', async () => {
    const browse = stubBrowse(DATA)
    const onOpen = vi.fn()
    render(<Browse onOpen={onOpen} />)

    expect(await screen.findByRole('heading', { name: 'Browse' })).toBeDefined()
    expect(browse).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab', { name: 'Series' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Campaign 4')).toBeDefined()
    expect(screen.queryByText('Previously On...')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Campaign 4/ }))
    expect(onOpen).toHaveBeenCalledWith(DATA.series[0])
  })

  it('switches to the collections tab', async () => {
    stubBrowse(DATA)
    render(<Browse onOpen={vi.fn()} />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Collections' }))

    expect(screen.getByText('Previously On...')).toBeDefined()
    expect(screen.queryByText('Campaign 4')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Collections' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('sorts by collection release date and can switch the order', async () => {
    stubBrowse({
      series: [
        card('old', 'Old Show', '2024-01-01T00:00:00.000Z'),
        card('new', 'New Show', '2026-01-01T00:00:00.000Z'),
        card('mid', 'Mid Show', '2025-01-01T00:00:00.000Z')
      ],
      collections: []
    })
    const { container } = render(<Browse onOpen={vi.fn()} />)

    await screen.findByText('New Show')
    const titles = (): (string | null)[] =>
      [...container.querySelectorAll('.grid .tile__title')].map((el) => el.textContent)

    expect(titles()).toEqual(['New Show', 'Mid Show', 'Old Show'])
    expect(screen.getByRole('button', { name: 'Newest' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'A-Z' }))
    expect(titles()).toEqual(['Mid Show', 'New Show', 'Old Show'])

    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))
    expect(titles()).toEqual(['Old Show', 'Mid Show', 'New Show'])

    fireEvent.click(screen.getByRole('button', { name: 'Z-A' }))
    expect(titles()).toEqual(['Old Show', 'New Show', 'Mid Show'])
  })

  it('focuses the tabs when both groups have something', async () => {
    stubBrowse(DATA)
    render(<Browse onOpen={vi.fn()} />)

    await screen.findByRole('heading', { name: 'Browse' })
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('.tab'))
  })

  it('starts on collections when there are no series', async () => {
    stubBrowse({ series: [], collections: [card('previously-on', 'Previously On...')] })
    render(<Browse onOpen={vi.fn()} />)

    expect(await screen.findByText('Previously On...')).toBeDefined()
    expect(screen.queryByRole('tab')).toBeNull()
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('.grid [data-focus]'))
  })

  it('says when there is nothing to browse', async () => {
    stubBrowse({ series: [], collections: [] })
    render(<Browse onOpen={vi.fn()} />)

    expect(await screen.findByText('Nothing to browse yet.')).toBeDefined()
  })

  it('shows a clean error from the main process', async () => {
    stubBrowse(
      Promise.reject(new Error("Error invoking remote method 'catalog:browse': Error: Offline."))
    )
    render(<Browse onOpen={vi.fn()} />)

    expect(await screen.findByText('Offline.')).toBeDefined()
  })
})
