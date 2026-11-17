import { useEffect, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { cleanError } from '../lib/errors'
import { focusFirst } from '../nav/focus'
import { backdropUrl } from '../lib/images'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

interface ContentProps {
  slug: string
  onOpen: (card: Card) => void
  onPlay: (slug: string, startAt?: number) => void
  /** Open the sign-in screen; used when the video is locked to guests. */
  onSignIn?: () => void
  /** Bumped when playback ends or a watch mark lands; older data is stale. */
  refreshKey?: number
  /** Lets screens behind this one drop their cached progress too. */
  onWatchedChanged?: () => void
}

/** Beacon's body text, with any CMS markup removed but paragraph breaks kept. */
const cleanText = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export function Content({
  slug,
  onOpen,
  onPlay,
  onSignIn,
  refreshKey = 0,
  onWatchedChanged
}: ContentProps): React.JSX.Element | null {
  // Keep the page on screen while it reloads: it is what the player uncovers.
  const { data, error, loading } = useAsync(
    () => window.beacon.catalog.content(slug),
    [slug, refreshKey],
    { keepData: true }
  )
  const placed = useRef(false)
  const wasLocked = useRef(false)
  const wasSignIn = useRef(false)
  // The toggle shows its result before the CMS has answered. The next read
  // replaces it, so this is a head start, not a second source of truth.
  const [watchedNow, setWatchedNow] = useState<boolean | null>(null)
  const [marking, setMarking] = useState(false)
  const [markError, setMarkError] = useState<string | null>(null)
  // Beacon's content page opens with the description clamped to three lines;
  // the rest of the body stays behind this toggle.
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setWatchedNow(null)
    setMarkError(null)
  }, [data])

  useEffect(() => {
    setExpanded(false)
  }, [slug])

  useEffect(() => {
    if (!data) return
    if (!placed.current) {
      placed.current = true
      // Play is the primary action. A guest gets the sign-in button; the
      // summary's See More must not take the first focus on entry.
      focusFirst(
        data.signInNeeded
          ? '[data-testid="signin"]'
          : data.locked
            ? '[data-focus]'
            : '[data-testid="play"]'
      )
    } else if (wasLocked.current && !data.locked) {
      // The account just unlocked this page: put focus on the new Play button.
      focusFirst('[data-testid="play"]')
    } else if (wasSignIn.current && !data.signInNeeded) {
      // Signed in, but the tier still excludes it; the sign-in button is gone.
      focusFirst('[data-focus]')
    }
    wasLocked.current = data.locked
    wasSignIn.current = data.signInNeeded
  }, [data])

  if (loading) {
    return (
      <div className="screen screen--center">
        <Spinner label="Loading episode" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="screen screen--center">
        <ErrorNote>{error}</ErrorNote>
      </div>
    )
  }
  if (!data) return null

  const resuming = data.resumeAt > 0
  const description = cleanText(data.description)
  const continuedSummary = cleanText(data.continuedSummary)
  // Only offer the toggle when there is a continuation to reveal. The app also
  // clamps a description that has none, which leaves a See More that does
  // nothing; showing the whole description is the better trade.
  const canExpand = Boolean(continuedSummary)
  const watched = watchedNow ?? data.watched
  const toggleWatched = async (): Promise<void> => {
    if (marking) return
    const next = !watched
    setMarking(true)
    setMarkError(null)
    setWatchedNow(next)
    try {
      const state = await window.beacon.watch.mark(slug, next)
      setWatchedNow(state.watched)
      onWatchedChanged?.()
    } catch (err) {
      setWatchedNow(null)
      setMarkError(cleanError(err))
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="screen screen--split">
      <header className="page-head page-head--tall">
        {data.image ? <img className="page-head__bg" src={backdropUrl(data.image, data.image2x) ?? undefined} alt="" /> : null}
        <div className="page-head__shade" />
        <div className="page-head__body">
          {data.series ? <p className="page-head__eyebrow">{data.series.title}</p> : null}
          <h1 className="page-head__title">{data.title}</h1>
          <p className="page-head__sub">
            {[data.minutes ? `${data.minutes} min` : null, data.tier].filter(Boolean).join(' · ')}
          </p>
          {description || canExpand ? (
            <div className="page-head__summary">
              {description ? (
                <p className={`page-head__desc${canExpand && !expanded ? ' is-clamped' : ''}`}>
                  {description}
                </p>
              ) : null}
              {expanded && continuedSummary ? (
                <p className="page-head__desc page-head__desc--continued">{continuedSummary}</p>
              ) : null}
              {canExpand ? (
                <button
                  type="button"
                  className="page-head__more"
                  data-focus
                  tabIndex={-1}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((open) => !open)}
                >
                  {expanded ? 'See Less' : '...See More'}
                </button>
              ) : null}
            </div>
          ) : null}

          {data.locked ? (
            <div className="page-head__locked">
              <p>
                {data.signInNeeded
                  ? 'Sign in with a Beacon account to watch this.'
                  : 'Your membership level does not include this video.'}
              </p>
              {data.signInNeeded && onSignIn ? (
                <button
                  type="button"
                  className="button button--primary"
                  data-focus
                  data-testid="signin"
                  tabIndex={-1}
                  onClick={onSignIn}
                >
                  Sign in
                </button>
              ) : null}
            </div>
          ) : null}

          {!data.locked ? (
            <div className="button-row">
              <button
                type="button"
                className="button button--primary"
                data-focus
                data-testid="play"
                tabIndex={-1}
                onClick={() => onPlay(slug)}
              >
                {resuming ? 'Resume' : 'Play'}
              </button>
              {resuming ? (
                <button
                  type="button"
                  className="button button--ghost"
                  data-focus
                  tabIndex={-1}
                  onClick={() => onPlay(slug, 0)}
                >
                  Start over
                </button>
              ) : null}
              {data.signedIn ? (
                <button
                  type="button"
                  className="button button--ghost"
                  data-focus
                  data-testid="watch-toggle"
                  tabIndex={-1}
                  disabled={marking}
                  onClick={() => void toggleWatched()}
                >
                  {watched ? 'Mark as unwatched' : 'Mark as watched'}
                </button>
              ) : null}
            </div>
          ) : null}
          {markError ? <ErrorNote>{markError}</ErrorNote> : null}
        </div>
      </header>

      <ScreenScroll>
        <div className="rows">
          {data.rows.map((row) => (
            <Row key={row.title} title={row.title} items={row.items} onSelect={onOpen} />
          ))}
        </div>
      </ScreenScroll>
    </div>
  )
}
