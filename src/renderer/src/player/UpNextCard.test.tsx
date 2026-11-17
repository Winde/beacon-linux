// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextEpisode } from '@shared/types'
import { UpNextCard } from './UpNextCard'

afterEach(cleanup)

const offer: NextEpisode = {
  slug: 'c3e121-part-2',
  title: 'Part 2',
  image: 'https://images.example/part-2/format=auto',
  minutes: 64,
  autoplayDisabled: false
}

describe('UpNextCard', () => {
  it('names the episode and counts down to the automatic start', () => {
    render(<UpNextCard offer={offer} remaining={12} onPlay={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByText('Up next')).toBeDefined()
    expect(screen.getByText('Part 2')).toBeDefined()
    expect(screen.getByText(/64 min/)).toBeDefined()
    expect(screen.getByText(/Playing in 12s/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Play next: Part 2' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Keep watching' })).toBeDefined()
  })

  it('says it is starting now when the countdown has run out', () => {
    render(<UpNextCard offer={offer} remaining={0} onPlay={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByText(/Playing now/)).toBeDefined()
  })

  it('offers an explicit play and dismiss when autoplay is disabled', () => {
    render(
      <UpNextCard
        offer={{ ...offer, autoplayDisabled: true }}
        remaining={15}
        onPlay={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText(/Play next/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDefined()
    expect(screen.queryByText(/Playing in/)).toBeNull()
  })

  it('reports the chosen action instead of deciding for the caller', () => {
    const onPlay = vi.fn()
    const onDismiss = vi.fn()
    render(<UpNextCard offer={offer} remaining={10} onPlay={onPlay} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Play next: Part 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep watching' }))

    expect(onPlay).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('leaves out the artwork when the next episode has none', () => {
    const { container } = render(
      <UpNextCard
        offer={{ ...offer, image: null }}
        remaining={10}
        onPlay={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(container.querySelector('.player__upnext-image')).toBeNull()
  })
})
