import { useEffect, useLayoutEffect, useState } from 'react'
import type { CredentialStorage } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { cleanError } from '../lib/errors'
import { ErrorNote } from '../components/ui'

interface LoginProps {
  onSignedIn: () => void | Promise<void>
  onSkip: () => void
}

export function Login({ onSignedIn, onSkip }: LoginProps): React.JSX.Element {
  const [email, setEmail] = useState(() => localStorage.getItem('beacon.email') ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storage, setStorage] = useState<CredentialStorage | null>(null)

  useLayoutEffect(() => {
    focusFirst('[data-focus]')
  }, [])

  useEffect(() => {
    void window.beacon.auth
      .storage()
      .then(setStorage)
      .catch(() => setStorage('unavailable'))
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.beacon.auth.signIn(email, password)
      localStorage.setItem('beacon.email', email.trim())
      // The app fetches the first feed before it takes the form away, so the
      // button keeps spinning until the screen behind it is ready.
      await onSignedIn()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const storageNote =
    storage === 'unavailable'
      ? 'Nothing is kept between launches; your password is never stored.'
      : storage === 'plaintext'
        ? 'Your password is never stored — only the sign-in tokens, saved on this device with weaker encryption.'
        : 'Your password is never stored — only the sign-in tokens.'

  return (
    <div className="login">
      <div className="login__panel">
        <p className="login__brand">Beacon</p>
        <p className="login__unofficial">Unofficial client · not affiliated with Critical Role</p>
        <h1 className="login__title">Sign in</h1>
        <p className="login__lede">
          Use your Beacon member account. Free videos work without signing in.
        </p>

        {storage === 'unavailable' ? (
          <p className="login__warning" role="status">
            Beacon can't save your sign-in on this system. You'll need to enter your password again
            after closing the app.
          </p>
        ) : null}
        {storage === 'plaintext' ? (
          <p className="login__warning" role="status">
            No keyring is available on this system. Your sign-in is saved with Electron's fallback
            encryption, which is obfuscation rather than real protection: anything that can read
            your user files can recover it.
          </p>
        ) : null}

        <form onSubmit={submit} className="login__form">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              data-focus
              tabIndex={-1}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              autoComplete="current-password"
              data-focus
              tabIndex={-1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your beacon.tv password"
            />
          </label>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <button
            type="submit"
            className="button button--primary"
            data-focus
            tabIndex={-1}
            disabled={busy || !email || !password}
          >
            {busy ? (
              <>
                <span className="button__spinner" aria-hidden />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <button
          type="button"
          className="button button--ghost"
          data-focus
          data-testid="skip"
          tabIndex={-1}
          onClick={onSkip}
        >
          Continue with free videos
        </button>

        <p className="login__hint">
          On a Steam Deck, press <kbd>STEAM</kbd> + <kbd>X</kbd> to bring up the on-screen keyboard.{' '}
          {storageNote}
        </p>
      </div>
    </div>
  )
}
