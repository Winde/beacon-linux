// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, CollectionData } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { Collection } from './Collection'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function card(slug: string, title: string): Card {
  return { kind: 'video', slug, title, image: null, minutes: 55 }
}

function collectionData(overrides: Partial<CollectionData> = {}): CollectionData {
  return {
    id: 's1',
    slug: 'campaign-1',
    title: 'Campaign 1',
    image: 'https://images.example/page/format=auto',
    image2x: 'https://images.example/wide/format=auto',
    isSeries: true,
    seasons: [
      {
        title: 'Episodes',
        items: [card('c1e1', 'Episode 1'), card('c1e2', 'Episode 2'), card('c1e3', 'Episode 3')]
      }
    ],
    ...overrides
  }
}

function stubCollection(
  result: CollectionData | Promise<CollectionData>
): ReturnType<typeof vi.fn> {
  const collection = vi.fn(() => Promise.resolve(result))
  vi.stubGlobal('beacon', { catalog: { collection } })
  return collection
}

describe('Collection', () => {
  it('shows the loader while the collection loads', () => {
    stubCollection(new Promise<CollectionData>(() => {}))
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading series')).toBeDefined()
  })

  it('shows a clean error from the main process', async () => {
    stubCollection(
      Promise.reject(new Error("Error invoking remote method 'catalog:collection': Error: Series not found."))
    )
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)

    expect(await screen.findByText('Series not found.')).toBeDefined()
  })

  it('lists a single season without tabs', async () => {
    const collection = stubCollection(collectionData())
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })).toBeDefined()
    expect(screen.getByText('Series · 3 videos')).toBeDefined()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(collection).toHaveBeenCalledWith('campaign-1')
    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('.grid [data-focus]'))
  })

  it('calls a non-series entry a collection', async () => {
    stubCollection(collectionData({ isSeries: false, title: 'One Shots', seasons: [{ title: 'Videos', items: [card('o1', 'One Shot')] }] }))
    render(<Collection slug="one-shots" onOpen={vi.fn()} />)

    expect(await screen.findByText('Collection · 1 videos')).toBeDefined()
  })

  it('switches between seasons', async () => {
    stubCollection(
      collectionData({
        seasons: [
          { title: 'Season 1', items: [card('c1e1', 'Episode 1')] },
          { title: 'Season 2', items: [card('c2e1', 'Season Two One')] }
        ]
      })
    )
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)
    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Season 1', 'Season 2'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Episode 1')).toBeDefined()

    fireEvent.click(tabs[1])

    expect(screen.getByText('Season Two One')).toBeDefined()
    expect(screen.queryByText('Episode 1')).toBeNull()
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
  })

  it('starts on the season tabs when there is more than one', async () => {
    stubCollection(
      collectionData({
        seasons: [
          { title: 'Season 1', items: [card('c1e1', 'Episode 1')] },
          { title: 'Season 2', items: [card('c2e1', 'Season Two One')] }
        ]
      })
    )
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)
    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })

    await vi.waitFor(() => expect(focusFirst).toHaveBeenCalledWith('.tab'))
  })

  it('favourites the whole series', async () => {
    const onToggleFavourite = vi.fn()
    stubCollection(collectionData())
    render(
      <Collection
        slug="campaign-1"
        onOpen={vi.fn()}
        onToggleFavourite={onToggleFavourite}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add to favourites' }))

    expect(onToggleFavourite).toHaveBeenCalledWith({
      kind: 'series',
      id: 's1',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: 'https://images.example/page/format=auto',
      image2x: 'https://images.example/wide/format=auto',
      count: 3
    })
  })

  it('offers to remove a favourited series', async () => {
    stubCollection(collectionData())
    render(
      <Collection
        slug="campaign-1"
        onOpen={vi.fn()}
        onToggleFavourite={vi.fn()}
        inFavourites
      />
    )

    const toggle = await screen.findByRole('button', { name: 'Remove from favourites' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('hides the favourite control when signed out', async () => {
    stubCollection(collectionData())
    render(<Collection slug="campaign-1" onOpen={vi.fn()} />)

    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })
    expect(screen.queryByRole('button', { name: 'Add to favourites' })).toBeNull()
  })

  it('reloads when a watch mark changes progress', async () => {
    const collection = stubCollection(collectionData())
    const { rerender } = render(
      <Collection slug="campaign-1" onOpen={vi.fn()} refreshKey={0} />
    )
    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })

    rerender(<Collection slug="campaign-1" onOpen={vi.fn()} refreshKey={1} />)

    await vi.waitFor(() => expect(collection).toHaveBeenCalledTimes(2))
  })

  it('passes selections to the caller', async () => {
    const data = collectionData()
    const onOpen = vi.fn()
    stubCollection(data)
    render(<Collection slug="campaign-1" onOpen={onOpen} />)
    await screen.findByRole('heading', { level: 1, name: 'Campaign 1' })

    fireEvent.click(screen.getByText('Episode 2'))

    expect(onOpen).toHaveBeenCalledWith(data.seasons[0].items[1])
  })
})
