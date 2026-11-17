// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

beforeEach(() => {
  // jsdom has no layout engine, but focus navigation scrolls what it focuses.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('shows the question and every choice', () => {
    render(
      <ConfirmDialog
        title="Sign out?"
        message="You will need to sign in again."
        actions={[
          { label: 'Cancel', onSelect: vi.fn(), variant: 'primary', testId: 'cancel' },
          { label: 'Sign out', onSelect: vi.fn(), variant: 'danger', testId: 'confirm' }
        ]}
      />
    )

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Sign out?')).toBeDefined()
    expect(screen.getByText('You will need to sign in again.')).toBeDefined()
    expect(screen.getByTestId('cancel').className).toContain('button--primary')
    expect(screen.getByTestId('confirm').className).toContain('button--danger')
  })

  it('focuses the safe choice by default', () => {
    render(
      <ConfirmDialog
        title="Question"
        message="Message"
        actions={[
          { label: 'Keep', onSelect: vi.fn(), testId: 'keep' },
          { label: 'Delete', onSelect: vi.fn(), testId: 'delete' }
        ]}
      />
    )

    expect(document.activeElement).toBe(screen.getByTestId('keep'))
  })

  it('reports which choice was pressed', () => {
    const keep = vi.fn()
    const remove = vi.fn()
    render(
      <ConfirmDialog
        title="Question"
        message="Message"
        actions={[
          { label: 'Keep', onSelect: keep, testId: 'keep' },
          { label: 'Delete', onSelect: remove, testId: 'delete' }
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('delete'))
    expect(remove).toHaveBeenCalledOnce()
    expect(keep).not.toHaveBeenCalled()
  })
})
