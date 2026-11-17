import { useEffect, useMemo, useRef, useState } from 'react'
import { NavArrowDown, NavArrowUp } from 'iconoir-react'
import type { Card, FavouriteItem, Row as RowData } from '@shared/types'
import { isFavourite, toCard } from '@shared/favourites'
import { useAsync } from '../lib/useAsync'
import { backdropUrl, preloadAll } from '../lib/images'
import { focusFirst } from '../nav/focus'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

const FAVOURITES_ROW = 'Favourites'
const CONTINUE_ROW = 'Continue watching'
const NO_FAVOURITES: FavouriteItem[] = []

interface HomeRow extends RowData {
  favourites?: boolean
}

interface HomeProps {
  onOpen: (card: Card) => void
  onPlay: (card: Card) => void
  /** Bumped when playback ends; the feed is stale from then on. */
  refreshKey?: number
  /** Favourited series, in the account's order. Empty means no row is shown. */
  favourites?: FavouriteItem[]
  /** Rows above the Favourites row; null means just below Continue watching. */
  rowsAbove?: number | null
  onToggleFavourite?: (card: Card) => void
  /** Persist a new place for the Favourites row (rows above it). */
  onMoveFavourites?: (rowsAbove: number) => void
  /** Slugs whose favourite write is still in flight. */
  pendingFavourites?: ReadonlySet<string>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export function Home({
  onOpen,
  onPlay,
  refreshKey = 0,
  favourites = NO_FAVOURITES,
  rowsAbove = null,
  onToggleFavourite,
  onMoveFavourites,
  pendingFavourites
}: HomeProps): React.JSX.Element | null {
  // The previous feed stays on screen while the refresh runs: this reload
  // happens behind the viewer, who is looking at the screen below the player.
  const { data, error, loading } = useAsync(
    () => window.beacon.catalog.home(),
    [refreshKey],
    { keepData: true }
  )
  // The hero previews whatever the player is pointing at, so the backdrop
  // changes as focus moves rather than staying on the first featured item.
  const [preview, setPreview] = useState<Card | null>(null)
  const placed = useRef(false)

  // Home builds its shelves ad hoc, but the Favourites row is ours: it slots in
  // below Continue watching until the player moves it somewhere else.
  const rows = useMemo<HomeRow[]>(() => {
    if (!data || !favourites.length) return data?.rows ?? []
    const defaultAt = Math.max(0, data.rows.findIndex((row) => row.title === CONTINUE_ROW) + 1)
    const at = clamp(rowsAbove ?? defaultAt, 0, data.rows.length)
    return [
      ...data.rows.slice(0, at),
      { title: FAVOURITES_ROW, items: favourites.map(toCard), favourites: true },
      ...data.rows.slice(at)
    ]
  }, [data, favourites, rowsAbove])

  // The row's place among the real shelves, which is what the arrows move.
  const favouritesAt = rows.findIndex((row) => row.favourites)
  const lastAt = data?.rows.length ?? 0

  useEffect(() => {
    if (!data) return
    // Warm the featured backdrops so the first few focus moves have no wait.
    preloadAll(data.hero.map((card) => backdropUrl(card.image, card.image2x)))
    // A refreshed feed must not yank focus back to the top of the page.
    if (!placed.current) {
      placed.current = true
      focusFirst('[data-focus]')
    }
    // Nor keep previewing a title that just left the feed or the favourites.
    setPreview((current) => {
      if (!current) return current
      const present =
        data.hero.some((card) => card.slug === current.slug) ||
        data.rows.some((row) => row.items.some((item) => item.slug === current.slug)) ||
        isFavourite(favourites, current.slug)
      return present ? current : null
    })
  }, [data, favourites])

  if (loading) {
    return (
      <div className="screen screen--center">
        <Spinner label="Loading Beacon" />
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

  const featured = preview ?? data.hero[0]

  return (
    <div className="screen screen--split">
      {featured ? (
        <Hero
          card={featured}
          onOpen={onOpen}
          onPlay={onPlay}
          inFavourites={isFavourite(favourites, featured.slug)}
          onToggleFavourite={onToggleFavourite}
          favouritePending={pendingFavourites?.has(featured.slug)}
        />
      ) : null}
      <ScreenScroll>
        <div className="rows">
          {rows.map((row) =>
            row.favourites ? (
              <Row
                key="favourites"
                title={row.title}
                items={row.items}
                onSelect={onOpen}
                onFocus={setPreview}
                actions={
                  onMoveFavourites ? (
                    <div className="row__actions">
                      <button
                        type="button"
                        className="row__move"
                        data-focus
                        data-testid="favourites-up"
                        tabIndex={-1}
                        title="Move up"
                        aria-label="Move Favourites up"
                        disabled={favouritesAt <= 0}
                        onClick={() => onMoveFavourites(Math.max(0, favouritesAt - 1))}
                      >
                        <NavArrowUp width={18} height={18} strokeWidth={1.8} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="row__move"
                        data-focus
                        data-testid="favourites-down"
                        tabIndex={-1}
                        title="Move down"
                        aria-label="Move Favourites down"
                        disabled={favouritesAt < 0 || favouritesAt >= lastAt}
                        onClick={() => onMoveFavourites(Math.min(lastAt, favouritesAt + 1))}
                      >
                        <NavArrowDown width={18} height={18} strokeWidth={1.8} aria-hidden />
                      </button>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <Row
                key={row.title}
                title={row.title}
                items={row.items}
                onSelect={onOpen}
                onFocus={setPreview}
              />
            )
          )}
        </div>
      </ScreenScroll>
    </div>
  )
}
