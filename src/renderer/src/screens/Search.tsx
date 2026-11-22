import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card, SearchData } from '@shared/types'
import { focusFirst, setFocused } from '../nav/focus'
import { OnScreenKeyboard } from '../components/OnScreenKeyboard'
import { Row } from '../components/Row'
import { Empty } from '../components/ui'

const MAX_QUERY = 40

interface SearchProps {
  onOpen: (card: Card) => void
}

/**
 * A search screen that owns its input: a d-pad keyboard for the pad, live
 * results beside it, and suggestions pulled from the local catalog.
 *
 * There is no text field on purpose. Focusing one hands the job to the
 * platform's on-screen keyboard, whose Enter arrives as a plain `accept` and
 * presses whatever happened to be focused on the screen underneath.
 */
export function Search({ onOpen }: SearchProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchData | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  // A spinner that appears on every keystroke reads as flicker; only show one
  // once the search has actually taken a moment.
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    focusFirst('.keyboard .key')
  }, [])

  // A physical keyboard still types: handled in the capture phase so Backspace
  // and Space never fall through to the global shortcuts while this screen is
  // the visible route.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!root.current || root.current.offsetParent === null) return
      // Playback owns the keyboard while it is on screen.
      if (document.querySelector('.player')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        setQuery((current) => current.slice(0, -1))
        return
      }
      if (event.key.length === 1 && /^[a-z0-9 ]$/i.test(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        setQuery((current) =>
          current.length >= MAX_QUERY ? current : current + event.key.toLowerCase()
        )
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const type = (char: string): void =>
    setQuery((current) => (current.length >= MAX_QUERY ? current : current + char))

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    window.beacon.catalog
      .suggest(trimmed)
      .then((list) => {
        if (!cancelled) setSuggestions(list.slice(0, 6))
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [query])

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

  useEffect(() => {
    if (!loading) {
      setBusy(false)
      return
    }
    const timer = window.setTimeout(() => setBusy(true), 220)
    return () => window.clearTimeout(timer)
  }, [loading])

  /** Hand focus to the results, the way a TV search jumps to its hits. */
  const submit = (): void => {
    const first = root.current?.querySelector<HTMLElement>('.search__results [data-focus]')
    if (first) setFocused(first)
  }

  const empty = results && !loading && !results.series.length && !results.videos.length

  return (
    <div className="screen screen--search" ref={root}>
      <header className="search__head">
        <h1 className="search__title">Search</h1>
        <div className="search__field">
          {query ? (
            <span>{query}</span>
          ) : (
            <span className="search__placeholder">Series, collection, or c4e12</span>
          )}
          <span className="search__caret" />
          {/* Fixed-size slot: the indicator fades in without moving anything. */}
          <span className={`search__busy${busy ? ' is-visible' : ''}`} role="status">
            {busy ? (
              <>
                <span className="spinner__ring spinner__ring--small" aria-hidden />
                <span className="sr-only">Searching</span>
              </>
            ) : null}
          </span>
        </div>
      </header>

      <div className="search__body">
        <div className="search__panel">
          <OnScreenKeyboard
            onChar={type}
            onBackspace={() => setQuery((current) => current.slice(0, -1))}
            onClear={() => setQuery('')}
            onSubmit={submit}
          />
          {suggestions.length ? (
            <div className="search__suggestions" data-focus-row>
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="chip"
                  data-focus
                  tabIndex={-1}
                  onClick={() => setQuery(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={`search__results${loading ? ' is-stale' : ''}`}>
          {empty ? <Empty>Nothing matches “{query.trim()}”.</Empty> : null}

          {results && results.series.length ? (
            <Row title="Series & collections" items={results.series} onSelect={onOpen} />
          ) : null}

          {results && results.videos.length ? (
            <Row title="Videos" items={results.videos} onSelect={onOpen} />
          ) : null}

          {!query.trim() ? (
            <Empty>
              Try a series or collection name, an episode title, or an episode code like “c4e12”.
            </Empty>
          ) : null}
        </div>
      </div>
    </div>
  )
}
