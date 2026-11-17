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
      onSignOut={vi.fn()}
      version="0.1.4"
      availableVersion={null}
      checking={false}
      onCheckForUpdates={vi.fn()}
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

  it('offers Sign out to a signed-in member', () => {
    const onSignOut = vi.fn()
    render(rail({ onSignOut }))

    fireEvent.click(screen.getByTestId('rail-signout'))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('hides Sign out from a free-video session', () => {
    render(rail({ onSignOut: undefined }))

    expect(screen.queryByTestId('rail-signout')).toBeNull()
  })

  it('is out of the navigation order while closed', () => {
    render(rail({ open: false }))

    expect(screen.getByTestId('rail-search').closest('nav')?.hasAttribute('inert')).toBe(true)
  })

  it('is navigable while open', () => {
    render(rail())

    expect(screen.getByTestId('rail-search').closest('nav')?.hasAttribute('inert')).toBe(false)
  })

  it('always shows the version at the foot of the rail', () => {
    render(rail({ version: '0.1.4' }))

    expect(screen.getByTestId('rail-version').textContent).toBe('v0.1.4')
  })

  it('keeps the version even when there is no account action', () => {
    render(rail({ onSignOut: undefined }))

    expect(screen.queryByTestId('rail-signout')).toBeNull()
    expect(screen.getByTestId('rail-version').textContent).toBe('v0.1.4')
  })

  it('checks for updates from the rail', () => {
    const onCheckForUpdates = vi.fn()
    render(rail({ onCheckForUpdates }))

    expect(screen.getByTestId('rail-update').textContent).toContain('Check for updates')
    fireEvent.click(screen.getByTestId('rail-update'))

    expect(onCheckForUpdates).toHaveBeenCalledOnce()
  })

  it('names the release a check found', () => {
    render(rail({ availableVersion: '0.2.0' }))

    expect(screen.getByTestId('rail-update').textContent).toContain('Update to v0.2.0')
  })

  it('says when a check is in flight', () => {
    render(rail({ checking: true }))

    expect(screen.getByTestId('rail-update').textContent).toContain('Checking…')
    expect(screen.getByTestId('rail-update')).toHaveProperty('disabled', true)
  })
})
