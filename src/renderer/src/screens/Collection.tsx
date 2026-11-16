import { useEffect, useState } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { focusFirst } from '../nav/focus'
import { backdropUrl } from '../lib/images'
import { Tile } from '../components/Tile'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

interface CollectionProps {
  slug: string
  onOpen: (card: Card) => void
}

export function Collection({ slug, onOpen }: CollectionProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(
    () => window.beacon.catalog.collection(slug),
    [slug]
  )
  const [seasonIndex, setSeasonIndex] = useState(0)

  useEffect(() => {
    if (data) focusFirst('[data-focus]')
  }, [data])

  if (loading) {
    return (
      <div className="screen screen--center">
        <Spinner label="Loading series" />
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

  const season = data.seasons[Math.min(seasonIndex, data.seasons.length - 1)]

  return (
    <div className="screen screen--split">
      <header className="page-head">
        {data.image ? <img className="page-head__bg" src={backdropUrl(data.image, data.image2x) ?? undefined} alt="" /> : null}
        <div className="page-head__shade" />
        <div className="page-head__body">
          <h1 className="page-head__title">{data.title}</h1>
          <p className="page-head__sub">
            {data.isSeries ? 'Series' : 'Collection'} · {data.seasons.reduce((n, s) => n + s.items.length, 0)} videos
          </p>
        </div>
      </header>

      {data.seasons.length > 1 ? (
        <div className="tabs" role="tablist">
          {data.seasons.map((item, index) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              aria-selected={index === seasonIndex}
              className={`tab${index === seasonIndex ? ' is-active' : ''}`}
              data-focus
              tabIndex={-1}
              onClick={() => setSeasonIndex(index)}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      <ScreenScroll>
        <div className="grid">
          {season?.items.map((card) => (
            <Tile key={card.slug} card={card} onSelect={onOpen} />
          ))}
        </div>
      </ScreenScroll>
    </div>
  )
}
