import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useGamepadCount, useInput } from './input/useInput'
import { focusFirst, getFocused, move, setFocused } from './nav/focus'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { Collection } from './screens/Collection'
import { Content } from './screens/Content'
import { Search } from './screens/Search'
import { Player, type PlayerHandle } from './screens/Player'
import { Spinner } from './components/ui'

type Route =
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'collection'; slug: string }
  | { name: 'content'; slug: string }
  | { name: 'search' }

interface Entry {
  id: number
  route: Route
}

export default function App(): React.JSX.Element {
  const [stack, setStack] = useState<Entry[]>([])
  const [player, setPlayer] = useState<{ slug: string; startAt?: number } | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const nextId = useRef(0)
  const pads = useGamepadCount()

  const push = useCallback((route: Route) => {
    setStack((current) => [...current, { id: nextId.current++, route }])
  }, [])

  const reset = useCallback((route: Route) => {
    setStack([{ id: nextId.current++, route }])
  }, [])

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current))
  }, [])

  const openCard = useCallback(
    (card: Card) => {
      if (card.kind === 'series') push({ name: 'collection', slug: card.slug })
      else push({ name: 'content', slug: card.slug })
    },
    [push]
  )

  const play = useCallback((slug: string, startAt?: number) => {
    lastFocus.current = getFocused()
    setPlayer({ slug, startAt })
  }, [])

  const closePlayer = useCallback(() => {
    setPlayer(null)
    const previous = lastFocus.current
    if (previous?.isConnected) setFocused(previous)
    else focusFirst()
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.beacon.auth.status(), window.beacon.app.initialSlug()])
      .then(([status, slug]) => {
        if (cancelled) return
        const home: Route = status.signedIn ? { name: 'home' } : { name: 'login' }
        if (slug) {
          setStack([
            { id: nextId.current++, route: home },
            { id: nextId.current++, route: { name: 'content', slug } }
          ])
        } else {
          reset(home)
        }
      })
      .catch(() => {
        if (!cancelled) reset({ name: 'login' })
      })
    return () => {
      cancelled = true
    }
  }, [reset])

  useInput((action) => {
    if (player) {
      playerRef.current?.handle(action)
      return
    }

    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        move(action)
        return
      case 'accept': {
        const active = document.activeElement as HTMLElement | null
        if (active instanceof HTMLInputElement) {
          active.form?.requestSubmit()
          return
        }
        active?.click()
        return
      }
      case 'back': {
        const active = document.activeElement as HTMLElement | null
        if (active instanceof HTMLInputElement) {
          active.blur()
          const next = document.querySelector<HTMLElement>('[data-focus]:not(input)')
          if (next) setFocused(next)
          return
        }
        back()
        return
      }
      case 'search':
        push({ name: 'search' })
        return
      default:
        return
    }
  })

  const current = stack[stack.length - 1]

  if (!current) {
    return (
      <div className="boot">
        <Spinner label="Beacon" />
      </div>
    )
  }

  const renderRoute = (route: Route): React.JSX.Element | null => {
    switch (route.name) {
      case 'login':
        return (
          <Login
            onSignedIn={() => reset({ name: 'home' })}
            onSkip={() => reset({ name: 'home' })}
          />
        )
      case 'home':
        return <Home onOpen={openCard} />
      case 'collection':
        return <Collection slug={route.slug} onOpen={openCard} />
      case 'content':
        return <Content slug={route.slug} onOpen={openCard} onPlay={play} />
      case 'search':
        return <Search onOpen={openCard} />
      default:
        return null
    }
  }

  return (
    <div className="app">
      {stack.map((entry, index) => (
        <div
          key={entry.id}
          className="route"
          style={{ display: index === stack.length - 1 ? 'block' : 'none' }}
        >
          {renderRoute(entry.route)}
        </div>
      ))}

      {current.route.name === 'home' ? (
        <div className="hintbar">
          <span className="hintbar__tag">Unofficial client</span>
          {pads > 0 ? (
            <>
              <span>
                <kbd>A</kbd> select
              </span>
              <span>
                <kbd>B</kbd> back
              </span>
              <span>
                <kbd>X</kbd> search
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd>Enter</kbd> select
              </span>
              <span>
                <kbd>Esc</kbd> back
              </span>
              <span>
                <kbd>X</kbd> search
              </span>
            </>
          )}
        </div>
      ) : null}

      {player ? (
        <Player
          key={player.slug}
          ref={playerRef}
          slug={player.slug}
          startAt={player.startAt}
          onClose={closePlayer}
        />
      ) : null}
    </div>
  )
}
