// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePrompt } from './UpdateDialog'
import { UpdateDialog } from './UpdateDialog'

beforeEach(() => {
  // Focus navigation scrolls what it focuses; jsdom has no layout engine.
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('beacon', { updates: { notes: vi.fn(() => Promise.resolve([])) } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPrompt(
  prompt: UpdatePrompt,
  overrides: { onInstall?: () => void; onRetry?: () => void } = {}
): {
  onClose: ReturnType<typeof vi.fn>
  onInstall: ReturnType<typeof vi.fn>
  onRetry: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  const onInstall = vi.fn(overrides.onInstall ?? (() => {}))
  const onRetry = vi.fn(overrides.onRetry ?? (() => {}))
  render(<UpdateDialog prompt={prompt} onClose={onClose} onInstall={onInstall} onRetry={onRetry} />)
  return { onClose, onInstall, onRetry }
}

describe('UpdateDialog', () => {
  it('only offers to close when the build is current', () => {
    const { onClose } = renderPrompt({ name: 'current', version: '0.2.0' })

    expect(screen.getByText('Beacon v0.2.0 is the latest version.')).toBeDefined()
    fireEvent.click(screen.getByTestId('update-close'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers Later and Update now when the build can replace itself', () => {
    const { onInstall } = renderPrompt({
      name: 'available',
      current: '0.1.4',
      latest: '0.2.0',
      canInstall: true
    })

    expect(screen.getByText(/checks it against the release's SHA-256/)).toBeDefined()
    expect(screen.getByText(/Open it again from Steam to finish/)).toBeDefined()
    fireEvent.click(screen.getByTestId('update-install'))

    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('says to download it when this copy cannot update itself', () => {
    renderPrompt({
      name: 'available',
      current: '0.1.4',
      latest: '0.2.0',
      canInstall: false
    })

    expect(screen.getByText(/can't replace itself/)).toBeDefined()
    expect(screen.queryByTestId('update-install')).toBeNull()
  })

  it('has no action while the update is installing', () => {
    renderPrompt({ name: 'installing', latest: '0.2.0' })

    expect(screen.getByText(/Downloading Beacon v0.2.0/)).toBeDefined()
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('says the app is closing once the file is in place', () => {
    renderPrompt({ name: 'closing', latest: '0.2.0' })

    expect(screen.getByText(/Beacon v0\.2\.0 is installed\. Closing Beacon/)).toBeDefined()
    expect(screen.getByText(/open it again from Steam/)).toBeDefined()
  })

  it('offers Try again after a failed install', () => {
    const { onRetry } = renderPrompt({
      name: 'failed',
      stage: 'install',
      reason: 'The downloaded update failed its checksum.'
    })

    expect(screen.getByText("Couldn't update Beacon")).toBeDefined()
    expect(screen.getByText('The downloaded update failed its checksum.')).toBeDefined()
    fireEvent.click(screen.getByTestId('update-retry'))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('names the check as the failed stage', () => {
    renderPrompt({ name: 'failed', stage: 'check', reason: 'Could not reach GitHub.' })

    expect(screen.getByText("Couldn't check for updates")).toBeDefined()
  })

  it('lists the release notes between the running version and the offered one', async () => {
    vi.stubGlobal('beacon', {
      updates: {
        notes: vi.fn(() =>
          Promise.resolve([
            { version: '0.2.0', notes: 'Player changes.' },
            { version: '0.1.5', notes: 'Caption fix.' }
          ])
        )
      }
    })
    renderPrompt({ name: 'available', current: '0.1.4', latest: '0.2.0', canInstall: true })

    expect(await screen.findByRole('heading', { name: 'v0.2.0' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'v0.1.5' })).toBeDefined()
    expect(screen.getByText('Player changes.')).toBeDefined()
    expect(screen.getByText('Caption fix.')).toBeDefined()
  })

  it('keeps the install action when the notes cannot be loaded', async () => {
    vi.stubGlobal('beacon', {
      updates: { notes: vi.fn(() => Promise.reject(new Error('offline'))) }
    })
    const { onInstall } = renderPrompt({
      name: 'available',
      current: '0.1.4',
      latest: '0.2.0',
      canInstall: true
    })

    expect(await screen.findByText(/Release notes couldn't be loaded/)).toBeDefined()
    fireEvent.click(screen.getByTestId('update-install'))
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('does not ask for notes when no update is on offer', () => {
    const notes = vi.fn(() => Promise.resolve([]))
    vi.stubGlobal('beacon', { updates: { notes } })
    renderPrompt({ name: 'current', version: '0.2.0' })

    expect(notes).not.toHaveBeenCalled()
  })
})
