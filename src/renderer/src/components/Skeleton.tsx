import { useEffect, useState } from 'react'
import { SPINNER_DELAY } from './ui'

/**
 * Page-shaped placeholders. A screen with nothing cached should look like the
 * page it is about to become, not like a blank screen with a spinner.
 */
export function SkeletonBlock({ className = '' }: { className?: string }): React.JSX.Element {
  return <span className={`skeleton ${className}`.trim()} aria-hidden />
}

/**
 * Hold a skeleton back for as long as a spinner would be held back. A fast
 * local read should not flash a page-shaped placeholder any more than it should
 * flash a spinner.
 */
export function DelayedSkeleton({
  label,
  delay = SPINNER_DELAY,
  children
}: {
  label: string
  delay?: number
  children: React.ReactNode
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return visible ? (
    <>
      {children}
      <SkeletonStatus label={label} />
    </>
  ) : null
}

/** A status line for screen readers; the blocks themselves are decorative. */
export function SkeletonStatus({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="sr-only" role="status">
      {label}
    </span>
  )
}

export function SkeletonTiles({ count = 8 }: { count?: number }): React.JSX.Element {
  return (
    <div className="skeleton-grid" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-tile" key={index}>
          <SkeletonBlock className="skeleton-tile__art" />
          <SkeletonBlock className="skeleton-tile__title" />
          <SkeletonBlock className="skeleton-tile__sub" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonRows({
  rows = 2,
  tiles = 6
}: {
  rows?: number
  tiles?: number
}): React.JSX.Element {
  return (
    <div className="rows" aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <section className="row skeleton-row" key={row}>
          <div className="row__head">
            <SkeletonBlock className="skeleton-row__title" />
          </div>
          <div className="row__track">
            {Array.from({ length: tiles }, (_, tile) => (
              <div className="skeleton-tile" key={tile}>
                <SkeletonBlock className="skeleton-tile__art" />
                <SkeletonBlock className="skeleton-tile__title" />
                <SkeletonBlock className="skeleton-tile__sub" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
