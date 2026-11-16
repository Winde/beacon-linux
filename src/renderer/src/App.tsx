import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { useInput } from './input/useInput'
import { focusFirst, getFocused, move, setFocused } from './nav/focus'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { Collection } from './screens/Collection'
import { Content } from './screens/Content'
import { Search } from './screens/Search'
import { Player, type PlayerHandle } from './screens/Player'
import { NavRail } from './components/NavRail'
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
  const [railOpen, setRailOpen] = useState(false)
  const railReturn = useRef<HTMLElement | null>(null)
  /** Whether the rail should offer Sign out; guests have no account to leave. */
  const [signedIn, setSignedIn] = useState(false)
  // Bumped when the player closes. What is behind it has just learned about
  // progress it did not have when its data was built, and screens stay mounted
  // while the player is open, so nothing else would refresh them.
  const [progressVersion, setProgressVersion] = useState(0)

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

  const playCard = useCallback((card: Card) => play(card.slug), [play])

  const closePlayer = useCallback(() => {
    setPlayer(null)
    setProgressVersion((version) => version + 1)
    const previous = lastFocus.current
    if (previous?.isConnected) setFocused(previous)
    else focusFirst()
  }, [])

  // Advancing replaces the slug and nothing else: lastFocus still points at the
  // card the run started from, so Back returns there rather than to an episode
  // the viewer never picked.
  const playNext = useCallback((slug: string) => {
    setPlayer({ slug })
  }, [])

  const openRail = useCallback(() => {
    railReturn.current = getFocused()
    setRailOpen(true)
  }, [])

  const closeRail = useCallback(() => {
    setRailOpen(false)
    const previous = railReturn.current
    if (previous?.isConnected) setFocused(previous)
    else focusFirst()
  }, [])

  const openSearch = useCallback(() => {
    setRailOpen(false)
    push({ name: 'search' })
  }, [push])

  // Home is a root destination, not another screen on top of the current one:
  // drop the whole stack so Back from Home exits instead of retracing a trail
  // the player has already chosen to abandon.
  const goHome = useCallback(() => {
    setRailOpen(false)
    reset({ name: 'home' })
  }, [reset])

  // Signing out clears the stored session, the cached rows and the prefilled
  // address, so a shared Deck does not hand the next person the last account.
  const signOut = useCallback(async () => {
    setRailOpen(false)
    await window.beacon.auth.signOut().catch(() => {})
    try {
      window.localStorage.removeItem('beacon.email')
    } catch {
      // Storage can be unavailable; the session itself is already gone.
    }
    setSignedIn(false)
    reset({ name: 'login' })
  }, [reset])

  // The rail is only focusable while open, so focus it once it is on screen.
  // Queried directly rather than through focusFirst(): that helper skips
  // elements whose computed visibility is hidden, which is exactly what the
  // rail is mid-transition.
  useEffect(() => {
    if (!railOpen) return
    const item = document.querySelector<HTMLElement>('.rail [data-focus]')
    if (item) setFocused(item)
  }, [railOpen])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.beacon.auth.status(), window.beacon.app.initialSlug()])
      .then(([status, slug]) => {
        if (cancelled) return
        setSignedIn(status.signedIn)
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
      case 'right': {
        if (railOpen) {
          // The rail is the leftmost thing on screen; right hands the player
          // back to whatever they were on.
          if (action === 'right') {
            closeRail()
            return
          }
          if (action === 'left') return
          move(action)
          return
        }
        if (move(action)) return
        // Ran out of room to the left: that edge reveals the rail.
        if (action === 'left') openRail()
        return
      }
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
        if (railOpen) {
          closeRail()
          return
        }
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
      case 'search': {
        // Reopening from inside search would stack duplicate screens.
        const top = stack[stack.length - 1]
        if (top?.route.name !== 'search') push({ name: 'search' })
        return
      }
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
            onSignedIn={() => {
              setSignedIn(true)
              reset({ name: 'home' })
            }}
            onSkip={() => reset({ name: 'home' })}
          />
        )
      case 'home':
        return <Home onOpen={openCard} onPlay={playCard} refreshKey={progressVersion} />
      case 'collection':
        return <Collection slug={route.slug} onOpen={openCard} />
      case 'content':
        return (
          <Content
            slug={route.slug}
            onOpen={openCard}
            onPlay={play}
            refreshKey={progressVersion}
          />
        )
      case 'search':
        return <Search onOpen={openCard} />
      default:
        return null
    }
  }

  return (
    <div className={`app${railOpen ? ' app--rail' : ''}`}>
      <NavRail
        open={railOpen}
        showHome={current.route.name !== 'home'}
        onHome={goHome}
        onSearch={openSearch}
        onSignOut={signedIn ? signOut : undefined}
      />
      {stack.map((entry, index) => (
        <div
          key={entry.id}
          className="route"
          style={{ display: index === stack.length - 1 ? 'block' : 'none' }}
        >
          {renderRoute(entry.route)}
        </div>
      ))}

      {player ? (
        <Player
          key={player.slug}
          ref={playerRef}
          slug={player.slug}
          startAt={player.startAt}
          onClose={closePlayer}
          onPlayNext={playNext}
        />
      ) : null}
    </div>
  )
}
