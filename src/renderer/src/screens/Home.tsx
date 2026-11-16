import { useEffect } from 'react'
import type { Card } from '@shared/types'
import { useAsync } from '../lib/useAsync'
import { focusFirst } from '../nav/focus'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { ErrorNote, Spinner } from '../components/ui'

interface HomeProps {
  onOpen: (card: Card) => void
}

export function Home({ onOpen }: HomeProps): React.JSX.Element | null {
  const { data, error, loading } = useAsync(() => window.beacon.catalog.home(), [])

  useEffect(() => {
    if (data) focusFirst('[data-focus]')
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

  const featured = data.hero[0]

  return (
    <div className="screen">
      {featured ? <Hero card={featured} onPlay={onOpen} /> : null}
      <div className="rows">
        {data.rows.map((row) => (
          <Row key={row.title} title={row.title} items={row.items} onSelect={onOpen} />
        ))}
      </div>
    </div>
  )
}
