// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DelayedSpinner, Empty, ErrorNote, SPINNER_DELAY, Spinner } from './ui'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Spinner', () => {
  it('announces itself and names what is loading', () => {
    render(<Spinner label="Loading episode" />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading episode')).toBeDefined()
  })

  it('works without a label', () => {
    const { container } = render(<Spinner />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(container.querySelector('.spinner__label')).toBeNull()
  })
})

describe('DelayedSpinner', () => {
  it('stays out of the way while a load is still quick', () => {
    vi.useFakeTimers()
    render(<DelayedSpinner label="Loading Beacon" />)

    expect(screen.queryByRole('status')).toBeNull()
    act(() => vi.advanceTimersByTime(SPINNER_DELAY - 1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('appears once the wait is worth acknowledging', () => {
    vi.useFakeTimers()
    render(<DelayedSpinner label="Loading Beacon" />)

    act(() => vi.advanceTimersByTime(SPINNER_DELAY))

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Loading Beacon')).toBeDefined()
  })
})

describe('notes', () => {
  it('shows an error', () => {
    render(<ErrorNote>Video not found.</ErrorNote>)

    expect(screen.getByText('Video not found.')).toBeDefined()
  })

  it('shows an empty state', () => {
    render(<Empty>Nothing here yet.</Empty>)

    expect(screen.getByText('Nothing here yet.')).toBeDefined()
  })
})
