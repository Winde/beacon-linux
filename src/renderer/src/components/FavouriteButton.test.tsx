// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavouriteButton } from './FavouriteButton'

afterEach(cleanup)

describe('FavouriteButton', () => {
  it('offers to favourite when it is not saved', () => {
    const onToggle = vi.fn()
    render(<FavouriteButton active={false} onToggle={onToggle} />)

    const button = screen.getByRole('button', { name: 'Add to favourites' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('says it is favourited when saved', () => {
    render(<FavouriteButton active onToggle={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Remove from favourites' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-busy')).toBe('false')
  })

  it('keeps the new label while the write is pending, with a spinner', () => {
    render(<FavouriteButton active pending onToggle={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Remove from favourites' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('.button__spinner')).not.toBeNull()
    // The bookmark gives way to the spinner rather than sitting beside it.
    expect(button.querySelector('svg')).toBeNull()
  })
})
