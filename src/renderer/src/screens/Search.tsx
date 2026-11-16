import { useEffect, useState } from 'react'
import type { Card, SearchData } from '@shared/types'
import { focusFirst } from '../nav/focus'
import { Row } from '../components/Row'
import { Empty, Spinner } from '../components/ui'

interface SearchProps {
  onOpen: (card: Card) => void
}

export function Search({ onOpen }: SearchProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    focusFirst('[data-focus]')
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      window.beacon.catalog
        .search(trimmed)
        .then((data) => {
          if (!cancelled) setResults(data)
        })
        .catch(() => {
          if (!cancelled) setResults(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const empty = results && !results.series.length && !results.videos.length

  return (
    <div className="screen screen--search">
      <div className="search-head">
        <h1 className="search-title">Search</h1>
        <input
          className="search-input"
          type="search"
          data-focus
          tabIndex={-1}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Series, episode, or c4e12"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {loading ? <Spinner label="Searching" /> : null}

      {empty ? <Empty>Nothing matches “{query.trim()}”.</Empty> : null}

      {results && results.series.length ? (
        <Row title="Series" items={results.series} onSelect={onOpen} />
      ) : null}

      {results && results.videos.length ? (
        <Row title="Videos" items={results.videos} onSelect={onOpen} />
      ) : null}

      {!query.trim() ? (
        <Empty>
          Try a series name, an episode title, or an episode code like “c4e12”.
        </Empty>
      ) : null}
    </div>
  )
}
