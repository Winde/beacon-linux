// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Empty, ErrorNote, Spinner } from './ui'

afterEach(cleanup)

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
