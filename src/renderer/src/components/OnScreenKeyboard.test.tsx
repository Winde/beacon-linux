// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnScreenKeyboard } from './OnScreenKeyboard'

afterEach(cleanup)

function setup(): {
  onChar: ReturnType<typeof vi.fn>
  onBackspace: ReturnType<typeof vi.fn>
  onClear: ReturnType<typeof vi.fn>
  onSubmit: ReturnType<typeof vi.fn>
  container: HTMLElement
} {
  const onChar = vi.fn()
  const onBackspace = vi.fn()
  const onClear = vi.fn()
  const onSubmit = vi.fn()
  const { container } = render(
    <OnScreenKeyboard
      onChar={onChar}
      onBackspace={onBackspace}
      onClear={onClear}
      onSubmit={onSubmit}
    />
  )
  return { onChar, onBackspace, onClear, onSubmit, container }
}

describe('OnScreenKeyboard', () => {
  it('offers every letter and digit as a focusable key', () => {
    const { container } = setup()
    const keys = container.querySelectorAll<HTMLButtonElement>('.keyboard__grid .key')

    expect(keys).toHaveLength(36)
    for (const key of keys) {
      expect(key.hasAttribute('data-focus')).toBe(true)
      expect(key.tabIndex).toBe(-1)
    }
  })

  it('sends the lower-case letter a key stands for', () => {
    const { onChar } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: '4' }))

    expect(onChar).toHaveBeenNthCalledWith(1, 'c')
    expect(onChar).toHaveBeenNthCalledWith(2, '4')
  })

  it('offers Space, Delete, Clear and Search beside the grid', () => {
    const { onChar, onBackspace, onClear, onSubmit } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Space' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByTestId('search-submit'))

    expect(onChar).toHaveBeenCalledWith(' ')
    expect(onBackspace).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
