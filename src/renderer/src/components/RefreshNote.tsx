import { useEffect, useState } from 'react'

/** A fast refresh should not flash a label; only a slow one is worth naming. */
const SLOW_MS = 1_500

interface RefreshNoteProps {
  /** A feed refresh is in flight behind data that is already on screen. */
  refreshing: boolean
  /** The last refresh failed; the feed on screen is the cached one. */
  error: string | null
  /** Without data there is nothing stale to explain; the screen spinner has it. */
  hasData: boolean
}

/**
 * The one piece of chrome around stale-while-revalidate.
 *
 * A quick refresh stays invisible. If it takes long enough to notice, or
 * fails, a quiet pill in the top-right says so. It is never focusable: a
 * d-pad press belongs to the content, not to a status line.
 */
export function RefreshNote({ refreshing, error, hasData }: RefreshNoteProps): React.JSX.Element {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const up = (): void => setOnline(true)
    const down = (): void => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    if (!refreshing) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [refreshing])

  const stale = Boolean(error) && hasData
  const text =
    refreshing && slow && hasData
      ? 'Updating…'
      : stale
        ? online
          ? "Couldn't refresh — saved copy"
          : "You're offline"
        : null

  return (
    <div
      className={`refresh-note${text ? ' is-visible' : ''}${stale ? ' is-problem' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="refresh-note"
    >
      {text ? (
        <>
          <span className="refresh-note__dot" aria-hidden />
          {text}
        </>
      ) : null}
    </div>
  )
}
