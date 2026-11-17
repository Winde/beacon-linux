// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@shared/types'
import { HERO_WIDTH } from '../lib/images'
import { Hero } from './Hero'

afterEach(cleanup)

function card(overrides: Partial<Card> = {}): Card {
  return {
    kind: 'video',
    slug: 'c1e1',
    title: 'Campaign 1 Episode 1',
    subtitle: 'Campaign 1',
    image: 'https://images.example/thumb/format=auto',
    image2x: 'https://images.example/wide/format=auto',
    minutes: 55,
    ...overrides
  }
}

describe('Hero', () => {
  it('offers Play for an unlocked video', () => {
    const data = card()
    const onPlay = vi.fn()
    const onOpen = vi.fn()
    render(<Hero card={data} onOpen={onOpen} onPlay={onPlay} />)

    expect(screen.getByText('Featured')).toBeDefined()
    expect(screen.getByText('Campaign 1 Episode 1')).toBeDefined()
    expect(screen.getByText('Campaign 1 · 55 min')).toBeDefined()

    const play = screen.getByTestId('hero-play')
    expect(play.textContent).toBe('Play')
    fireEvent.click(play)

    expect(onPlay).toHaveBeenCalledWith(data)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers Resume for a started video', () => {
    const onPlay = vi.fn()
    render(<Hero card={card({ progress: 0.4 })} onOpen={vi.fn()} onPlay={onPlay} />)

    const button = screen.getByTestId('hero-play')
    expect(button.textContent).toBe('Resume')

    fireEvent.click(button)
    expect(onPlay).toHaveBeenCalled()
  })

  it('sends a locked video to its details instead of playing', () => {
    const onPlay = vi.fn()
    const onOpen = vi.fn()
    render(<Hero card={card({ locked: true })} onOpen={onOpen} onPlay={onPlay} />)

    const details = screen.getByTestId('hero-details')
    expect(details.textContent).toBe('Details')

    fireEvent.click(details)
    expect(onOpen).toHaveBeenCalled()
    expect(onPlay).not.toHaveBeenCalled()
  })

  it('browses a category instead of playing it', () => {
    const data = card({ kind: 'series', subtitle: undefined, minutes: null, count: 12 })
    const onPlay = vi.fn()
    const onOpen = vi.fn()
    render(<Hero card={data} onOpen={onOpen} onPlay={onPlay} />)

    expect(screen.getByText('12 videos')).toBeDefined()

    const browse = screen.getByTestId('hero-browse')
    expect(browse.textContent).toBe('Browse')

    fireEvent.click(browse)
    expect(onOpen).toHaveBeenCalledWith(data)
    expect(onPlay).not.toHaveBeenCalled()
  })

  it('favourites a series from the hero', () => {
    const data = card({ kind: 'series', subtitle: undefined, minutes: null, count: 12 })
    const onToggleFavourite = vi.fn()
    render(
      <Hero
        card={data}
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        onToggleFavourite={onToggleFavourite}
      />
    )

    fireEvent.click(screen.getByTestId('hero-favourite'))

    expect(onToggleFavourite).toHaveBeenCalledWith(data)
  })

  it('offers removal when the series is already favourited', () => {
    render(
      <Hero
        card={card({ kind: 'series', subtitle: undefined, minutes: null })}
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        onToggleFavourite={vi.fn()}
        inFavourites
      />
    )

    const toggle = screen.getByTestId('hero-favourite')
    expect(toggle.textContent).toBe('Remove from favourites')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('never offers a favourite on an episode', () => {
    render(
      <Hero
        card={card()}
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        onToggleFavourite={vi.fn()}
      />
    )

    expect(screen.queryByTestId('hero-favourite')).toBeNull()
  })

  it('hides the favourite control when the app does not offer one', () => {
    render(
      <Hero
        card={card({ kind: 'series', subtitle: undefined, minutes: null })}
        onOpen={vi.fn()}
        onPlay={vi.fn()}
      />
    )

    expect(screen.queryByTestId('hero-favourite')).toBeNull()
  })

  it('omits the subtitle parts a category does not have', () => {
    const { container } = render(
      <Hero card={card({ kind: 'series', subtitle: undefined, minutes: null })} onOpen={vi.fn()} onPlay={vi.fn()} />
    )

    expect(container.querySelector('.hero__sub')?.textContent).toBe('')
  })

  it('draws the full-size backdrop over the thumbnail stand-in', () => {
    const { container } = render(<Hero card={card()} onOpen={vi.fn()} onPlay={vi.fn()} />)

    expect(container.querySelector('.hero__bg--stand-in')?.getAttribute('src')).toBe(
      'https://images.example/thumb/format=auto'
    )
    expect(container.querySelector('.hero__bg--fresh')?.getAttribute('src')).toBe(
      `https://images.example/wide/format=auto,width=${HERO_WIDTH}`
    )
  })
})
