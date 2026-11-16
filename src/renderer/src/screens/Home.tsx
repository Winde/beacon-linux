import { useEffect, useState } from 'react'
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
}

export function Home({ onOpen }: HomeProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(() => window.beacon.catalog.home(), [])
  // The hero previews whatever the player is pointing at, so the backdrop
  // changes as focus moves rather than staying on the first featured item.
  const [preview, setPreview] = useState<Card | null>(null)

  useEffect(() => {
    if (!data) return
    focusFirst('[data-focus]')
    // Warm the featured backdrops so the first few focus moves have no wait.
    preloadAll(data.hero.map((card) => backdropUrl(card.image, card.image2x)))
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
      {featured ? <Hero card={featured} onPlay={onOpen} /> : null}
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
