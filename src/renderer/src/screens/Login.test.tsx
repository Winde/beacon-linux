// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialStorage } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { Login } from './Login'

vi.mock('../nav/focus', () => ({ focusFirst: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

beforeEach(() => {
  localStorage.clear()
})

function stubSignIn(storage: CredentialStorage = 'keyring'): ReturnType<typeof vi.fn> {
  const signIn = vi.fn(() => Promise.resolve({ signedIn: true, user: null }))
  vi.stubGlobal('beacon', {
    auth: { signIn, storage: vi.fn(() => Promise.resolve(storage)) }
  })
  return signIn
}

function fill(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}

const submit = (): HTMLElement => screen.getByRole('button', { name: /^Sign in$/ })

describe('Login', () => {
  it('focuses the form on mount', () => {
    stubSignIn()
    render(<Login onSignedIn={vi.fn()} onSkip={vi.fn()} />)

    expect(focusFirst).toHaveBeenCalledWith('[data-focus]')
  })

  it('remembers the last email', () => {
    localStorage.setItem('beacon.email', 'member@example.com')
    stubSignIn()
    render(<Login onSignedIn={vi.fn()} onSkip={vi.fn()} />)

    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.com')
  })

  it('keeps Sign in disabled until both fields are filled', () => {
    stubSignIn()
    render(<Login onSignedIn={vi.fn()} onSkip={vi.fn()} />)

    expect((submit() as HTMLButtonElement).disabled).toBe(true)

    fill('member@example.com', 'hunter2')
    expect((submit() as HTMLButtonElement).disabled).toBe(false)
  })

  it('signs in and remembers the email', async () => {
    const signIn = stubSignIn()
    const onSignedIn = vi.fn()
    render(<Login onSignedIn={onSignedIn} onSkip={vi.fn()} />)

    fill('member@example.com', 'hunter2')
    fireEvent.click(submit())

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(signIn).toHaveBeenCalledWith('member@example.com', 'hunter2')
    expect(localStorage.getItem('beacon.email')).toBe('member@example.com')
  })

  it('shows the reason a sign-in failed', async () => {
    const signIn = stubSignIn()
    vi.mocked(signIn).mockRejectedValue(
      new Error("Error invoking remote method 'auth:signIn': Error: Invalid credentials")
    )
    const onSignedIn = vi.fn()
    render(<Login onSignedIn={onSignedIn} onSkip={vi.fn()} />)

    fill('member@example.com', 'wrong')
    fireEvent.click(submit())

    expect(await screen.findByText('Invalid credentials')).toBeDefined()
    expect(onSignedIn).not.toHaveBeenCalled()
    expect((submit() as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows progress while signing in', async () => {
    const signIn = stubSignIn()
    let resolve!: (value: unknown) => void
    vi.mocked(signIn).mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const onSignedIn = vi.fn()
    render(<Login onSignedIn={onSignedIn} onSkip={vi.fn()} />)

    fill('member@example.com', 'hunter2')
    fireEvent.click(submit())

    const busy = screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)

    resolve({ signedIn: true, user: null })
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
  })

  it('continues with free videos', () => {
    stubSignIn()
    const onSkip = vi.fn()
    render(<Login onSignedIn={vi.fn()} onSkip={onSkip} />)

    fireEvent.click(screen.getByTestId('skip'))

    expect(onSkip).toHaveBeenCalled()
  })

  it('warns when the sign-in cannot be kept securely', async () => {
    stubSignIn('plaintext')
    render(<Login onSignedIn={vi.fn()} onSkip={vi.fn()} />)

    expect(await screen.findByText(/can't save your sign-in/)).toBeDefined()
  })

  it('warns when no keyring is available at all', async () => {
    stubSignIn('unavailable')
    render(<Login onSignedIn={vi.fn()} onSkip={vi.fn()} />)

    expect(await screen.findByText(/can't save your sign-in/)).toBeDefined()
  })
})
