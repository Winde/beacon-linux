import { useEffect, useMemo, useRef, useState } from 'react'
import { NavArrowDown, NavArrowUp } from 'iconoir-react'
import type { Card, FavouriteItem, FavouritesAnchor, HomeData, HomeRow } from '@shared/types'
import { isFavourite, toCard } from '@shared/favourites'
import { useAsync } from '../lib/useAsync'
import { backdropUrl, preloadAll } from '../lib/images'
import { focusFirst } from '../nav/focus'
import { Hero } from '../components/Hero'
import { RefreshNote } from '../components/RefreshNote'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { DelayedSkeleton, SkeletonBlock, SkeletonRows } from '../components/Skeleton'
import { ErrorNote } from '../components/ui'

const FAVOURITES_ROW = 'Favourites'
const NO_FAVOURITES: FavouriteItem[] = []

function HomeSkeleton(): React.JSX.Element {
  return (
    <div className="screen screen--split" aria-busy="true">
      <div className="hero-skeleton">
        <SkeletonBlock className="skeleton--eyebrow" />
        <SkeletonBlock className="skeleton--title" />
        <div className="skeleton-lines" aria-hidden>
          <SkeletonBlock />
          <SkeletonBlock />
        </div>
        <div className="button-row" aria-hidden>
          <SkeletonBlock className="skeleton-button" />
          <SkeletonBlock className="skeleton-button skeleton-button--ghost" />
        </div>
      </div>
      <ScreenScroll>
        <SkeletonRows rows={2} tiles={6} />
      </ScreenScroll>
    </div>
  )
}

interface HomeProps {
  onOpen: (card: Card) => void
  onPlay: (card: Card) => void
  /** Bumped when playback ends; the feed is stale from then on. */
  refreshKey?: number
  /** A feed the app fetched while the sign-in panel was still up. */
  initial?: HomeData
  /** Favourited series, in the account's order. Empty means no row is shown. */
  favourites?: FavouriteItem[]
  /** Which shelf the Favourites row follows; null keeps the default. */
  favouritesAfter?: FavouritesAnchor | null
  onToggleFavourite?: (card: Card) => void
  /** Persist where the Favourites row now sits. */
  onMoveFavourites?: (after: FavouritesAnchor) => void
  /** Slugs whose favourite write is still in flight. */
  pendingFavourites?: ReadonlySet<string>
  /** Re-read account data that another client may have changed. */
  onRevalidate?: () => void
}

export function Home({
  onOpen,
  onPlay,
  refreshKey = 0,
  initial,
  favourites = NO_FAVOURITES,
  favouritesAfter = null,
  onToggleFavourite,
  onMoveFavourites,
  pendingFavourites,
  onRevalidate
}: HomeProps): React.JSX.Element | null {
  // The previous feed stays on screen while the refresh runs: this reload
  // happens behind the viewer, who is looking at the screen below the player.
  // After sign-in there is no previous feed yet, so the app passes the one it
  // fetched while the sign-in panel was still up, and this screen never blanks
  // to a spinner of its own.
  // Coming back online, or back to the window, is the moment a cached feed is
  // most likely to be out of date. Both re-run the same held-data load.
  const [retry, setRetry] = useState(0)
  const { data, error, loading, refreshing } = useAsync(
    () => window.beacon.catalog.home(),
    [refreshKey, retry],
    { keepData: true, initial }
  )
  // The hero previews whatever the player is pointing at, so the backdrop
  // changes as focus moves rather than staying on the first featured item.
  const [preview, setPreview] = useState<Card | null>(null)
  const placed = useRef(false)

  useEffect(() => {
    const again = (): void => {
      setRetry((count) => count + 1)
      onRevalidate?.()
    }
    const visible = (): void => {
      if (!document.hidden) again()
    }
    window.addEventListener('online', again)
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', again)
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [onRevalidate])

  // Home ships its shelves in editorial order. Favourites is ours, so it is
  // dropped in after a named shelf rather than at an index that would drift
  // when Beacon adds or removes a block.
  const rows = useMemo<HomeRow[]>(() => {
    const base = data?.rows ?? []
    if (!favourites.length) return base
    // Default is just below Continue watching; a stale anchor (the block was
    // deleted, or an editor recreated it) falls back to that same place.
    const preferred = base.find((row) => row.kind === 'continue')?.id ?? 'top'
    const chosen = favouritesAfter ?? preferred
    const anchor = chosen === 'top' || base.some((row) => row.id === chosen) ? chosen : preferred
    const at = anchor === 'top' ? 0 : base.findIndex((row) => row.id === anchor) + 1
    return [
      ...base.slice(0, at),
      {
        id: 'favourites',
        kind: 'favourites',
        title: FAVOURITES_ROW,
        items: favourites.map(toCard)
      },
      ...base.slice(at)
    ]
  }, [data, favourites, favouritesAfter])

  const favouritesAt = rows.findIndex((row) => row.kind === 'favourites')

  const move = (direction: 'up' | 'down'): void => {
    const at = favouritesAt
    const target = direction === 'up' ? at - 1 : at + 1
    if (at < 0 || target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[at], next[target]] = [next[target], next[at]]
    // The anchor is the block the row now follows, not a position.
    onMoveFavourites?.(next[target - 1]?.id ?? 'top')
  }

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

  if (loading && !data) {
    return (
      <DelayedSkeleton label="Loading Beacon">
        <HomeSkeleton />
      </DelayedSkeleton>
    )
  }
  if (error && !data) {
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
      <RefreshNote refreshing={refreshing} error={error} hasData />
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
            row.kind === 'favourites' ? (
              <Row
                key={row.id}
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
                        onClick={() => move('up')}
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
                        disabled={favouritesAt < 0 || favouritesAt >= rows.length - 1}
                        onClick={() => move('down')}
                      >
                        <NavArrowDown width={18} height={18} strokeWidth={1.8} aria-hidden />
                      </button>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <Row
                key={row.id}
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
