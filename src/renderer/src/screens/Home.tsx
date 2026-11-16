import { useEffect, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { backdropUrl, preloadAll } from '../lib/images'
import { focusFirst } from '../nav/focus'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { ScreenScroll } from '../components/ScreenScroll'
import { ErrorNote, Spinner } from '../components/ui'

interface HomeProps {
  onOpen: (card: Card) => void
  onPlay: (card: Card) => void
  /** Bumped when playback ends; the feed is stale from then on. */
  refreshKey?: number
}

export function Home({ onOpen, onPlay, refreshKey = 0 }: HomeProps): React.JSX.Element | null {
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

  useEffect(() => {
    if (!data) return
    // Warm the featured backdrops so the first few focus moves have no wait.
    preloadAll(data.hero.map((card) => backdropUrl(card.image, card.image2x)))
    // A refreshed feed must not yank focus back to the top of the page.
    if (!placed.current) {
      placed.current = true
      focusFirst('[data-focus]')
    }
    // Nor keep previewing a title that just left the feed.
    setPreview((current) => {
      if (!current) return current
      const present =
        data.hero.some((card) => card.slug === current.slug) ||
        data.rows.some((row) => row.items.some((item) => item.slug === current.slug))
      return present ? current : null
    })
  }, [data])

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
      {featured ? <Hero card={featured} onOpen={onOpen} onPlay={onPlay} /> : null}
      <ScreenScroll>
        <div className="rows">
          {data.rows.map((row) => (
            <Row
              key={row.title}
              title={row.title}
              items={row.items}
              onSelect={onOpen}
              onFocus={setPreview}
            />
          ))}
        </div>
      </ScreenScroll>
    </div>
  )
}
