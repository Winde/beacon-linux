import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { BROWSE_SORTS, sortBrowseCards, type BrowseSort } from '../lib/browse'
import { focusFirst } from '../nav/focus'
import { ScreenScroll } from '../components/ScreenScroll'
import { Tile } from '../components/Tile'
import { SkeletonStatus, SkeletonTiles } from '../components/Skeleton'
import { Empty, ErrorNote } from '../components/ui'

type Tab = 'series' | 'collections'

interface BrowseProps {
  onOpen: (card: Card) => void
}

/**
 * Every series and collection in the local catalog, not just the shelves the
 * editors put on Home. Beacon files these separately, so the two groups get
 * their own tab rather than one mixed grid.
 */
export function Browse({ onOpen }: BrowseProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(() => window.beacon.catalog.browse(), [])
  const [chosen, setChosen] = useState<Tab | null>(null)
  // Beacon's own Series and Collections lists open on Newest First.
  const [sort, setSort] = useState<BrowseSort>('newest')
  const placed = useRef(false)

  const both = Boolean(data?.series.length && data?.collections.length)
  // A missing group must not leave the screen on an empty tab; the viewer can
  // still switch once the other one has something in it.
  const active: Tab = chosen ?? (data && !data.series.length ? 'collections' : 'series')
  const items = useMemo(() => {
    const source = active === 'series' ? (data?.series ?? []) : (data?.collections ?? [])
    return sortBrowseCards(source, sort)
  }, [active, data, sort])

  useEffect(() => {
    if (!data || placed.current) return
    placed.current = true
    focusFirst(data.series.length && data.collections.length ? '.tab' : '.grid [data-focus]')
  }, [data])

  if (loading) {
    return (
      <div className="screen screen--split" aria-busy="true">
        <header className="browse__head">
          <h1 className="browse__title">Browse</h1>
          <p className="browse__sub">Every series and collection in the catalog.</p>
        </header>
        <ScreenScroll>
          <SkeletonTiles count={12} />
        </ScreenScroll>
        <SkeletonStatus label="Loading series and collections" />
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

  return (
    <div className="screen screen--split">
      <header className="browse__head">
        <h1 className="browse__title">Browse</h1>
        <p className="browse__sub">Every series and collection in the catalog.</p>
      </header>

      {both ? (
        <div className="tabs" role="tablist" data-focus-row>
          {(['series', 'collections'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active === tab}
              className={`tab${active === tab ? ' is-active' : ''}`}
              data-focus
              tabIndex={-1}
              onClick={() => setChosen(tab)}
            >
              {tab === 'series' ? 'Series' : 'Collections'}
            </button>
          ))}
        </div>
      ) : null}

      {data.series.length || data.collections.length ? (
        <div className="tabs" role="group" aria-label="Sort" data-focus-row>
          <span className="tabs__label">Sort</span>
          {BROWSE_SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`tab${sort === option.value ? ' is-active' : ''}`}
              data-focus
              tabIndex={-1}
              aria-pressed={sort === option.value}
              title={option.title}
              onClick={() => setSort(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <ScreenScroll resetKey={`${active}:${sort}`}>
        {items.length ? (
          <div className="grid" data-focus-row>
            {items.map((card) => (
              <Tile key={card.slug} card={card} onSelect={onOpen} />
            ))}
          </div>
        ) : (
          <Empty>Nothing to browse yet.</Empty>
        )}
      </ScreenScroll>
    </div>
  )
}
