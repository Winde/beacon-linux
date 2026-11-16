// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WatchlistButton } from './WatchlistButton'

afterEach(cleanup)

describe('WatchlistButton', () => {
  it('offers to add an unsaved title', () => {
    const onToggle = vi.fn()
    render(<WatchlistButton active={false} onToggle={onToggle} />)

    const button = screen.getByRole('button', { name: 'Add to watchlist' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('offers to remove a saved title', () => {
    const onToggle = vi.fn()
    render(<WatchlistButton active onToggle={onToggle} testId="hero-watchlist" />)

    const button = screen.getByTestId('hero-watchlist')
    expect(button.textContent).toBe('Remove from watchlist')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('is reachable with the controller', () => {
    render(<WatchlistButton active={false} onToggle={vi.fn()} />)

    const button = screen.getByRole('button')
    expect(button.hasAttribute('data-focus')).toBe(true)
    expect(button.getAttribute('tabindex')).toBe('-1')
  })
})
