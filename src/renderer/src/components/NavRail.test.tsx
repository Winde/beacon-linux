// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavRail } from './NavRail'

afterEach(cleanup)

function rail(overrides: Partial<React.ComponentProps<typeof NavRail>> = {}): React.JSX.Element {
  return (
    <NavRail
      open
      showHome
      onHome={vi.fn()}
      onSearch={vi.fn()}
      {...overrides}
    />
  )
}

describe('NavRail', () => {
  it('offers Home when there is somewhere to go back to', () => {
    const onHome = vi.fn()
    render(rail({ onHome }))

    fireEvent.click(screen.getByTestId('rail-home'))

    expect(onHome).toHaveBeenCalledOnce()
  })

  it('hides Home while already on it', () => {
    render(rail({ showHome: false }))

    expect(screen.queryByTestId('rail-home')).toBeNull()
    expect(screen.getByTestId('rail-search')).toBeDefined()
  })

  it('keeps Search available from Home', () => {
    const onSearch = vi.fn()
    render(rail({ showHome: false, onSearch }))

    fireEvent.click(screen.getByTestId('rail-search'))

    expect(onSearch).toHaveBeenCalledOnce()
  })
})
