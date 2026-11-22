import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Card, CollectionData } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { isPageMissing, PageMissingError } from '../lib/errors'
import { pageCache } from '../lib/pages'
import { focusFirst } from '../nav/focus'
import { backdropUrl } from '../lib/images'
import { Tile } from '../components/Tile'
import { ScreenScroll } from '../components/ScreenScroll'
import { FavouriteButton } from '../components/FavouriteButton'
import { RefreshNote } from '../components/RefreshNote'
import { SkeletonBlock, SkeletonStatus, SkeletonTiles } from '../components/Skeleton'
import { ErrorNote } from '../components/ui'

interface CollectionProps {
  slug: string
  /** The tile that opened this page; its title and art carry the first paint. */
  card?: Card
  onOpen: (card: Card) => void
  /** Bumped when playback ends or a watch mark lands; card progress is stale. */
  refreshKey?: number
  /** Show the favourite control, and whether this series is already favourited. */
  onToggleFavourite?: (card: Card) => void
  inFavourites?: boolean
  /** The favourite write for this series is still in flight. */
  favouritePending?: boolean
}

function CollectionSkeleton({ card }: { card?: Card }): React.JSX.Element {
  return (
    <div className="screen screen--split" aria-busy="true">
      <header className="page-head">
        <div className="page-head__art">
          {card?.image ? (
            <img
              className="page-head__bg"
              src={backdropUrl(card.image, card.image2x) ?? undefined}
              alt=""
            />
          ) : null}
          <div className="page-head__shade" />
        </div>
        <div className="page-head__body">
          {card ? (
            <>
              <h1 className="page-head__title">{card.title}</h1>
              <p className="page-head__sub">
                {card.count ? `${card.count} videos` : 'Loading videos'}
              </p>
            </>
          ) : (
            <>
              <SkeletonBlock className="skeleton--eyebrow" />
              <SkeletonBlock className="skeleton--title" />
              <SkeletonBlock className="skeleton--sub" />
            </>
          )}
        </div>
      </header>
      <ScreenScroll>
        <SkeletonTiles count={8} />
      </ScreenScroll>
      <SkeletonStatus label="Loading series" />
    </div>
  )
}

export function Collection({
  slug,
  card,
  onOpen,
  refreshKey = 0,
  onToggleFavourite,
  inFavourites = false,
  favouritePending = false
}: CollectionProps): React.JSX.Element | null {
  // A page from this run or the last launch paints immediately. The request
  // still runs, so the page is never treated as fresh; `keepData` leaves it on
  // screen while that refresh is in flight.
  const initial = useMemo(() => pageCache.collection(slug), [slug])
  const { data, error, loading, refreshing } = useAsync(
    async (): Promise<CollectionData> => {
      const page = await window.beacon.catalog.collection(slug)
      if (!page) {
        pageCache.forgetCollection(slug)
        throw new PageMissingError('Series not found.')
      }
      pageCache.rememberCollection(page)
      return page
    },
    [slug, refreshKey],
    { keepData: true, initial: initial ?? undefined, dropDataOnError: isPageMissing }
  )
  const [seasonIndex, setSeasonIndex] = useState(0)
  const placed = useRef(false)

  useLayoutEffect(() => {
    if (!data || placed.current) return
    placed.current = true
    // Browsing is the point of this screen: put focus on the seasons or the
    // first episode, not on the header's favourite control.
    focusFirst(data.seasons.length > 1 ? '.tab' : '.grid [data-focus]')
  }, [data])

  if (loading && !data) {
    return <CollectionSkeleton card={card} />
  }
  if (error && !data) {
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
      <RefreshNote refreshing={refreshing} error={error} hasData />
      <header className="page-head">
        <div className="page-head__art">
          {data.image ? (
            <img
              className="page-head__bg"
              src={backdropUrl(data.image, data.image2x) ?? undefined}
              alt=""
            />
          ) : null}
          <div className="page-head__shade" />
        </div>
        <div className="page-head__body">
          <h1 className="page-head__title">{data.title}</h1>
          <p className="page-head__sub">
            {data.isSeries ? 'Series' : 'Collection'} · {total} videos
          </p>
          {onToggleFavourite ? (
            <div className="button-row" data-focus-row>
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
        <div className="tabs" role="tablist" data-focus-row>
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

      <ScreenScroll resetKey={seasonIndex}>
        <div className="grid" data-focus-row>
          {season?.items.map((item) => (
            <Tile key={item.slug} card={item} onSelect={onOpen} />
          ))}
        </div>
      </ScreenScroll>
    </div>
  )
}
