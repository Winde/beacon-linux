// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@shared/types'
import { Tile } from './Tile'

afterEach(cleanup)

function card(overrides: Partial<Card> = {}): Card {
  return {
    kind: 'video',
    slug: 'c1e1',
    title: 'Campaign 1 Episode 1',
    subtitle: 'Campaign 1',
    image: 'https://images.example/art/format=auto',
    minutes: 55,
    ...overrides
  }
}

describe('Tile', () => {
  it('shows the title, series and length of a video', () => {
    render(<Tile card={card()} onSelect={vi.fn()} />)

    expect(screen.getByText('Campaign 1 Episode 1')).toBeDefined()
    expect(screen.getByText('Campaign 1')).toBeDefined()
    expect(screen.getByText('55 min')).toBeDefined()
  })

  it('renders the artwork as decoration', () => {
    const { container } = render(<Tile card={card()} onSelect={vi.fn()} />)

    const image = container.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://images.example/art/format=auto')
    expect(image.getAttribute('alt')).toBe('')
    expect(image.getAttribute('loading')).toBe('lazy')
  })

  it('falls back to an empty frame without artwork', () => {
    const { container } = render(<Tile card={card({ image: null })} onSelect={vi.fn()} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.tile__art-empty')).not.toBeNull()
  })

  it('badges items that need a membership', () => {
    render(<Tile card={card({ locked: true })} onSelect={vi.fn()} />)

    expect(screen.getByText('Members')).toBeDefined()
  })

  it('counts the videos in a series instead of showing a length', () => {
    render(
      <Tile
        card={card({ kind: 'series', count: 12, minutes: null, subtitle: undefined })}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('12 videos')).toBeDefined()
    expect(screen.queryByText(/min$/)).toBeNull()
  })

  it('fills the progress bar and clamps it at 100%', () => {
    const { container, rerender } = render(
      <Tile card={card({ progress: 0.4 })} onSelect={vi.fn()} />
    )

    const bar = (): HTMLElement => container.querySelector<HTMLElement>('.tile__progress span')!
    expect(bar().style.width).toBe('40%')

    rerender(<Tile card={card({ progress: 1.4 })} onSelect={vi.fn()} />)
    expect(bar().style.width).toBe('100%')
  })

  it('hides the progress bar for an unstarted video', () => {
    const { container } = render(<Tile card={card({ progress: 0.005 })} onSelect={vi.fn()} />)

    expect(container.querySelector('.tile__progress')).toBeNull()
  })

  it('reports the selected card', () => {
    const onSelect = vi.fn()
    const data = card()
    render(<Tile card={data} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith(data)
  })

  it('reports focus', () => {
    const onFocus = vi.fn()
    const data = card()
    render(<Tile card={data} onSelect={vi.fn()} onFocus={onFocus} />)

    fireEvent.focus(screen.getByRole('button'))

    expect(onFocus).toHaveBeenCalledWith(data)
  })

  it('carries the large size class', () => {
    const { container } = render(<Tile card={card()} size="large" onSelect={vi.fn()} />)

    expect(container.querySelector('.tile--large')).not.toBeNull()
  })
})
