import { useEffect, useState } from 'react'
import { focusFirst } from '../nav/focus'
import { cleanError } from '../lib/errors'
import { ErrorNote } from '../components/ui'

interface LoginProps {
  onSignedIn: () => void
  onSkip: () => void
}

export function Login({ onSignedIn, onSkip }: LoginProps): React.JSX.Element {
  const [email, setEmail] = useState(() => localStorage.getItem('beacon.email') ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    focusFirst('[data-focus]')
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.beacon.auth.signIn(email, password)
      localStorage.setItem('beacon.email', email.trim())
      onSignedIn()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <p className="login__brand">Beacon</p>
        <p className="login__unofficial">Unofficial client · not affiliated with Critical Role</p>
        <h1 className="login__title">Sign in</h1>
        <p className="login__lede">
          Use your Beacon member account. Free videos work without signing in.
        </p>

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
            {busy ? 'Signing in…' : 'Sign in'}
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
          On a Steam Deck, press <kbd>STEAM</kbd> + <kbd>X</kbd> to bring up the on-screen
          keyboard. Your password is never stored — only the sign-in tokens.
        </p>
      </div>
    </div>
  )
}
