import { useEffect, useState } from 'react'

/** A load this short is over before a spinner would have said anything useful. */
export const SPINNER_DELAY = 300

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="spinner" role="status">
      <span className="spinner__ring" />
      {label ? <span className="spinner__label">{label}</span> : null}
    </div>
  )
}

/**
 * A spinner that waits before appearing.
 *
 * Startup is a few local reads; painting a spinner for one frame and replacing
 * it with Home is a flicker, not feedback. A slow boot still gets the spinner
 * once the wait is worth acknowledging.
 */
export function DelayedSpinner({
  label,
  delay = SPINNER_DELAY
}: {
  label?: string
  delay?: number
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return visible ? <Spinner label={label} /> : null
}

export function ErrorNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="error-note">{children}</p>
}

export function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="empty">{children}</p>
}
