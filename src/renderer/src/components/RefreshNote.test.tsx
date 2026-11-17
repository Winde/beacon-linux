// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefreshNote } from './RefreshNote'

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

beforeEach(() => {
  setOnline(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'onLine')
})

describe('RefreshNote', () => {
  it('stays quiet when a refresh lands quickly', () => {
    vi.useFakeTimers()
    const { rerender } = render(<RefreshNote refreshing error={null} hasData />)

    act(() => vi.advanceTimersByTime(600))
    rerender(<RefreshNote refreshing={false} error={null} hasData />)
    act(() => vi.advanceTimersByTime(2_000))

    expect(screen.getByTestId('refresh-note').textContent).toBe('')
  })

  it('names a refresh that takes longer than a moment', () => {
    vi.useFakeTimers()
    render(<RefreshNote refreshing error={null} hasData />)

    act(() => vi.advanceTimersByTime(1_499))
    expect(screen.getByTestId('refresh-note').textContent).toBe('')

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('refresh-note').textContent).toContain('Updating…')
    // Status must never take a d-pad press.
    expect(screen.getByTestId('refresh-note').querySelector('[data-focus]')).toBeNull()
  })

  it('hides the chip when the refresh lands', () => {
    vi.useFakeTimers()
    const { rerender } = render(<RefreshNote refreshing error={null} hasData />)
    act(() => vi.advanceTimersByTime(1_500))
    expect(screen.getByTestId('refresh-note').textContent).toContain('Updating…')

    rerender(<RefreshNote refreshing={false} error={null} hasData />)

    expect(screen.getByTestId('refresh-note').textContent).toBe('')
  })

  it('says the app is offline when the saved feed cannot refresh', () => {
    setOnline(false)
    render(<RefreshNote refreshing={false} error="Network down" hasData />)

    expect(screen.getByTestId('refresh-note').textContent).toContain("You're offline")
  })

  it('names a failed refresh when the connection is up', () => {
    render(<RefreshNote refreshing={false} error="HTTP 500" hasData />)

    expect(screen.getByTestId('refresh-note').textContent).toContain(
      "Couldn't refresh — saved copy"
    )
  })

  it('leaves errors without data to the screen', () => {
    render(<RefreshNote refreshing={false} error="Network down" hasData={false} />)

    expect(screen.getByTestId('refresh-note').textContent).toBe('')
  })

  it('keeps a first load quiet even when it is slow', () => {
    vi.useFakeTimers()
    render(<RefreshNote refreshing error={null} hasData={false} />)

    act(() => vi.advanceTimersByTime(5_000))

    expect(screen.getByTestId('refresh-note').textContent).toBe('')
  })
})
