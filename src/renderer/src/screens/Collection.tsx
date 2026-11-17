import { useEffect, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { focusFirst } from '../nav/focus'
import { backdropUrl } from '../lib/images'
import { Tile } from '../components/Tile'
import { ScreenScroll } from '../components/ScreenScroll'
import { FavouriteButton } from '../components/FavouriteButton'
import { ErrorNote, Spinner } from '../components/ui'

interface CollectionProps {
  slug: string
  onOpen: (card: Card) => void
  /** Bumped when playback ends or a watch mark lands; card progress is stale. */
  refreshKey?: number
  /** Show the favourite control, and whether this series is already favourited. */
  onToggleFavourite?: (card: Card) => void
  inFavourites?: boolean
  /** The favourite write for this series is still in flight. */
  favouritePending?: boolean
}

export function Collection({
  slug,
  onOpen,
  refreshKey = 0,
  onToggleFavourite,
  inFavourites = false,
  favouritePending = false
}: CollectionProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(
    () => window.beacon.catalog.collection(slug),
    [slug, refreshKey]
  )
  const [seasonIndex, setSeasonIndex] = useState(0)
  const placed = useRef(false)

  useEffect(() => {
    if (!data || placed.current) return
    placed.current = true
    // Browsing is the point of this screen: put focus on the seasons or the
    // first episode, not on the header's favourite control.
    focusFirst(data.seasons.length > 1 ? '.tab' : '.grid [data-focus]')
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
  const total = data.seasons.reduce((count, item) => count + item.items.length, 0)
  const favourite: Card = {
    kind: 'series',
    id: data.id,
    slug: data.slug,
    title: data.title,
    image: data.image,
    image2x: data.image2x,
    count: total
  }

  return (
    <div className="screen screen--split">
      <header className="page-head">
        {data.image ? <img className="page-head__bg" src={backdropUrl(data.image, data.image2x) ?? undefined} alt="" /> : null}
        <div className="page-head__shade" />
        <div className="page-head__body">
          <h1 className="page-head__title">{data.title}</h1>
          <p className="page-head__sub">
            {data.isSeries ? 'Series' : 'Collection'} · {total} videos
          </p>
          {onToggleFavourite ? (
            <div className="button-row">
              <FavouriteButton
                active={inFavourites}
                pending={favouritePending}
                onToggle={() => onToggleFavourite(favourite)}
              />
            </div>
          ) : null}
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
