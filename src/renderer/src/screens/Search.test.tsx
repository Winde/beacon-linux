// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@shared/types'
import { focusFirst, setFocused } from '../nav/focus'
import { Search } from './Search'

vi.mock('../nav/focus', () => ({
  focusFirst: vi.fn(),
  setFocused: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(focusFirst).mockClear()
  vi.mocked(setFocused).mockClear()
})

function card(slug: string, title: string, kind: Card['kind'] = 'video'): Card {
  return {
    kind,
    slug,
    title,
    subtitle: kind === 'video' ? 'Campaign 1' : undefined,
    image: `https://images.example/${slug}/format=auto`,
    image2x: null,
    minutes: kind === 'video' ? 55 : undefined,
    count: kind === 'series' ? 12 : undefined
  }
}

function stubCatalog(
  options: {
    suggest?: () => Promise<string[]>
    search?: () => Promise<{ series: Card[]; videos: Card[] }>
  } = {}
): { suggest: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> } {
  const suggest = vi.fn(options.suggest ?? (() => Promise.resolve([])))
  const search = vi.fn(options.search ?? (() => Promise.resolve({ series: [], videos: [] })))
  vi.stubGlobal('beacon', { catalog: { suggest, search } })
  return { suggest, search }
}

function type(keys: string[]): void {
  for (const key of keys) fireEvent.click(screen.getByRole('button', { name: key }))
}

describe('Search', () => {
  it('puts focus on the on-screen keyboard and says what it accepts', () => {
    stubCatalog()
    render(<Search onOpen={vi.fn()} />)

    expect(focusFirst).toHaveBeenCalledWith('.keyboard .key')
    expect(screen.getByText('Series, collection, or c4e12')).toBeDefined()
    expect(
      screen.getByText(/Try a series or collection name, an episode title, or an episode code/)
    ).toBeDefined()
  })

  it('types with the on-screen keyboard and shows both result rows', async () => {
    const { search } = stubCatalog({
      search: () =>
        Promise.resolve({
          series: [card('campaign-1', 'Campaign One', 'series')],
          videos: [card('campaign-1e1', 'The Water’s Edge')]
        })
    })
    render(<Search onOpen={vi.fn()} />)

    type(['C', 'A'])

    await waitFor(() => expect(search).toHaveBeenCalledWith('ca'))
    expect(await screen.findByText('Campaign One')).toBeDefined()
    expect(await screen.findByText('The Water’s Edge')).toBeDefined()
    expect(screen.getByText('Series & collections')).toBeDefined()
    expect(screen.getByText('Videos')).toBeDefined()
  })

  it('adds a suggestion to the query when it is chosen', async () => {
    const { suggest, search } = stubCatalog({
      suggest: () => Promise.resolve(['Campaign 2']),
      search: () => Promise.resolve({ series: [], videos: [] })
    })
    render(<Search onOpen={vi.fn()} />)

    type(['C', 'A'])

    await waitFor(() => expect(suggest).toHaveBeenCalledWith('ca'))
    fireEvent.click(await screen.findByRole('button', { name: 'Campaign 2' }))

    await waitFor(() => expect(search).toHaveBeenCalledWith('Campaign 2'))
  })

  it('waits for two characters before searching', async () => {
    const { search } = stubCatalog()
    render(<Search onOpen={vi.fn()} />)

    type(['A'])
    await new Promise((resolve) => setTimeout(resolve, 260))
    expect(search).not.toHaveBeenCalled()

    type(['B'])
    await waitFor(() => expect(search).toHaveBeenCalledWith('ab'))
  })

  it('clears the query and returns to the prompt', () => {
    stubCatalog()
    render(<Search onOpen={vi.fn()} />)

    type(['A', 'B'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('Series, collection, or c4e12')).toBeDefined()
  })

  it('moves focus to the first result when Search is pressed', async () => {
    stubCatalog({
      search: () =>
        Promise.resolve({ series: [], videos: [card('campaign-1e1', 'The Water’s Edge')] })
    })
    render(<Search onOpen={vi.fn()} />)

    type(['C', 'A'])
    expect(await screen.findByText('The Water’s Edge')).toBeDefined()

    fireEvent.click(screen.getByTestId('search-submit'))

    expect(setFocused).toHaveBeenCalledTimes(1)
    expect(setFocused).toHaveBeenCalledWith(expect.any(HTMLElement))
  })

  it('says when nothing matches', async () => {
    stubCatalog({ search: () => Promise.resolve({ series: [], videos: [] }) })
    render(<Search onOpen={vi.fn()} />)

    type(['Z', 'Z'])

    expect(await screen.findByText(/Nothing matches/)).toBeDefined()
  })

  it('does not put a result in focus when there is none', async () => {
    stubCatalog({ search: () => Promise.resolve({ series: [], videos: [] }) })
    render(<Search onOpen={vi.fn()} />)

    type(['Z', 'Z'])
    await screen.findByText(/Nothing matches/)
    fireEvent.click(screen.getByTestId('search-submit'))

    expect(setFocused).not.toHaveBeenCalled()
  })

  it('types and deletes with a physical keyboard', async () => {
    // jsdom reports every element as unpositioned; the screen uses offsetParent
    // to tell whether it is still the visible route.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body
    })
    const { search } = stubCatalog({
      search: () => Promise.resolve({ series: [], videos: [card('c1e1', 'An Episode')] })
    })
    render(<Search onOpen={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'C' })
    fireEvent.keyDown(window, { key: 'a' })

    expect(screen.getByText('ca')).toBeDefined()
    await waitFor(() => expect(search).toHaveBeenCalledWith('ca'))

    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(screen.getByText('c')).toBeDefined()

    delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent
  })

  it('leaves modified keys and typing outside the visible search alone', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body
    })
    stubCatalog()
    render(<Search onOpen={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'a', metaKey: true })
    expect(screen.getByText('Series, collection, or c4e12')).toBeDefined()

    const player = document.createElement('div')
    player.className = 'player'
    document.body.append(player)
    fireEvent.keyDown(window, { key: 'c' })
    player.remove()
    expect(screen.getByText('Series, collection, or c4e12')).toBeDefined()

    delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent
  })

  it('caps the query at forty characters', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body
    })
    stubCatalog()
    render(<Search onOpen={vi.fn()} />)

    for (let index = 0; index < 45; index++) fireEvent.keyDown(window, { key: 'a' })

    expect(screen.getByText('a'.repeat(40))).toBeDefined()

    delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent
  })
})
