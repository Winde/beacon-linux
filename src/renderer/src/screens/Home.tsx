import { useEffect, useMemo, useRef, useState } from 'react'
import { NavArrowDown, NavArrowUp } from 'iconoir-react'
import type { Card, Row as RowData, WatchlistItem } from '@shared/types'
import { isWatchlisted, toCard } from '@shared/watchlist'
import { useAsync } from '../lib/useAsync'
import { backdropUrl, preloadAll } from '../lib/images'
import { focusFirst } from '../nav/focus'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

const WATCHLIST_ROW = 'Watchlist'
const CONTINUE_ROW = 'Continue watching'
const NO_WATCHLIST: WatchlistItem[] = []

interface HomeRow extends RowData {
  watchlist?: boolean
}

interface HomeProps {
  onOpen: (card: Card) => void
  onPlay: (card: Card) => void
  /** Bumped when playback ends; the feed is stale from then on. */
  refreshKey?: number
  /** Saved titles, newest first. Empty means no row is shown. */
  watchlist?: WatchlistItem[]
  /** Rows above the Watchlist row; null means just below Continue watching. */
  rowsAbove?: number | null
  onToggleWatchlist?: (card: Card) => void
  /** Persist a new place for the Watchlist row (rows above it). */
  onMoveWatchlist?: (rowsAbove: number) => void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export function Home({
  onOpen,
  onPlay,
  refreshKey = 0,
  watchlist = NO_WATCHLIST,
  rowsAbove = null,
  onToggleWatchlist,
  onMoveWatchlist
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

  // Home builds its shelves ad hoc, but the Watchlist row is ours: it slots in
  // below Continue watching until the player moves it somewhere else.
  const rows = useMemo<HomeRow[]>(() => {
    if (!data || !watchlist.length) return data?.rows ?? []
    const defaultAt = Math.max(0, data.rows.findIndex((row) => row.title === CONTINUE_ROW) + 1)
    const at = clamp(rowsAbove ?? defaultAt, 0, data.rows.length)
    return [
      ...data.rows.slice(0, at),
      { title: WATCHLIST_ROW, items: watchlist.map(toCard), watchlist: true },
      ...data.rows.slice(at)
    ]
  }, [data, watchlist, rowsAbove])

  // The row's place among the real shelves, which is what the arrows move.
  const watchlistAt = rows.findIndex((row) => row.watchlist)
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
    // Nor keep previewing a title that just left the feed or the watchlist.
    setPreview((current) => {
      if (!current) return current
      const present =
        data.hero.some((card) => card.slug === current.slug) ||
        data.rows.some((row) => row.items.some((item) => item.slug === current.slug)) ||
        isWatchlisted(watchlist, current.kind, current.slug)
      return present ? current : null
    })
  }, [data, watchlist])

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
          inWatchlist={isWatchlisted(watchlist, featured.kind, featured.slug)}
          onToggleWatchlist={onToggleWatchlist}
        />
      ) : null}
      <ScreenScroll>
        <div className="rows">
          {rows.map((row) =>
            row.watchlist ? (
              <Row
                key="watchlist"
                title={row.title}
                items={row.items}
                onSelect={onOpen}
                onFocus={setPreview}
                actions={
                  onMoveWatchlist ? (
                    <div className="row__actions">
                      <button
                        type="button"
                        className="row__move"
                        data-focus
                        data-testid="watchlist-up"
                        tabIndex={-1}
                        title="Move up"
                        aria-label="Move Watchlist up"
                        disabled={watchlistAt <= 0}
                        onClick={() => onMoveWatchlist(Math.max(0, watchlistAt - 1))}
                      >
                        <NavArrowUp width={18} height={18} strokeWidth={1.8} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="row__move"
                        data-focus
                        data-testid="watchlist-down"
                        tabIndex={-1}
                        title="Move down"
                        aria-label="Move Watchlist down"
                        disabled={watchlistAt < 0 || watchlistAt >= lastAt}
                        onClick={() => onMoveWatchlist(Math.min(lastAt, watchlistAt + 1))}
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
