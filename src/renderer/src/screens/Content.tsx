import { useEffect } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { focusFirst } from '../nav/focus'
import { backdropUrl } from '../lib/images'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

interface ContentProps {
  slug: string
  onOpen: (card: Card) => void
  onPlay: (slug: string, startAt?: number) => void
}

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

export function Content({ slug, onOpen, onPlay }: ContentProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(() => window.beacon.catalog.content(slug), [slug])

  useEffect(() => {
    if (data) focusFirst('[data-focus]')
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
          {data.description ? (
            <p className="page-head__desc">{stripHtml(data.description)}</p>
          ) : null}

          {data.locked ? (
            <p className="page-head__locked">
              {data.signInNeeded
                ? 'Sign in with a Beacon account to watch this.'
                : 'Your membership level does not include this video.'}
            </p>
          ) : (
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
            </div>
          )}
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
