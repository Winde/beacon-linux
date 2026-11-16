// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@shared/types'
import { preload } from '../lib/images'
import { Row } from './Row'

vi.mock('../lib/images', () => ({
  backdropUrl: vi.fn((image: string | null, wide?: string | null) => wide ?? image),
  preload: vi.fn()
}))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(preload).mockClear()
})

function card(slug: string): Card {
  return {
    kind: 'video',
    slug,
    title: `Episode ${slug}`,
    image: `https://images.example/${slug}/format=auto`,
    image2x: `https://images.example/${slug}x/format=auto`
  }
}

const items = [card('a'), card('b'), card('c')]

describe('Row', () => {
  it('renders nothing for an empty row', () => {
    const { container } = render(<Row title="Empty" items={[]} onSelect={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders its title and one tile per item', () => {
    render(<Row title="Recently added" items={items} onSelect={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('renders actions beside the heading', () => {
    render(
      <Row
        title="Watchlist"
        items={items}
        onSelect={vi.fn()}
        actions={<button type="button">Move up</button>}
      />
    )

    expect(screen.getByRole('heading', { name: 'Watchlist' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDefined()
  })

  it('passes selections through', () => {
    const onSelect = vi.fn()
    render(<Row title="Row" items={items} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('Episode b'))

    expect(onSelect).toHaveBeenCalledWith(items[1])
  })

  it('reports focus on the card', () => {
    const onFocus = vi.fn()
    render(<Row title="Row" items={items} onSelect={vi.fn()} onFocus={onFocus} />)

    fireEvent.focusIn(screen.getByText('Episode c').closest('button')!)

    expect(onFocus).toHaveBeenCalledWith(items[2])
  })

  it('warms the backdrops on both sides of a focused tile', () => {
    render(<Row title="Row" items={items} onSelect={vi.fn()} />)

    fireEvent.focusIn(screen.getByText('Episode b').closest('button')!)

    expect(preload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(preload)).toHaveBeenCalledWith('https://images.example/ax/format=auto')
    expect(vi.mocked(preload)).toHaveBeenCalledWith('https://images.example/cx/format=auto')
  })

  it('warms only the neighbour that exists at the ends', () => {
    render(<Row title="Row" items={items} onSelect={vi.fn()} />)

    fireEvent.focusIn(screen.getByText('Episode a').closest('button')!)
    expect(vi.mocked(preload).mock.calls).toEqual([['https://images.example/bx/format=auto']])

    vi.mocked(preload).mockClear()
    fireEvent.focusIn(screen.getByText('Episode c').closest('button')!)
    expect(vi.mocked(preload).mock.calls).toEqual([['https://images.example/bx/format=auto']])
  })
})
