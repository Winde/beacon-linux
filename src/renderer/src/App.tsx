import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, WatchlistData } from '@shared/types'
import { isWatchlisted } from '@shared/watchlist'
import { useInput } from './input/useInput'
import { focusFirst, getFocused, move, setFocused } from './nav/focus'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { Collection } from './screens/Collection'
import { Content } from './screens/Content'
import { Search } from './screens/Search'
import { Player, type PlayerHandle } from './screens/Player'
import { ConfirmDialog } from './components/ConfirmDialog'
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

/**
 * The rail while it is open. Navigation is confined to it: the rail covers the
 * screen, so the rows behind it must not win a d-pad move.
 */
function openRailElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.rail.is-open')
}

const EMPTY_WATCHLIST: WatchlistData = { items: [], rowsAbove: null }

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
  const [watchlist, setWatchlist] = useState<WatchlistData>(EMPTY_WATCHLIST)
  /** Signing out while a non-empty watchlist exists asks what to do with it. */
  const [signOutPrompt, setSignOutPrompt] = useState(false)
  const dialogReturn = useRef<HTMLElement | null>(null)
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

  // A watch mark changes the same data the player does: badges, resume points
  // and the rows behind this screen all described the moment before it.
  const watchedChanged = useCallback(() => {
    setProgressVersion((version) => version + 1)
  }, [])

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

  /**
   * Reload the list for whoever is signed in now. The API never sees this; the
   * main process only files it under the account's address.
   */
  const loadWatchlist = useCallback(async () => {
    try {
      setWatchlist(await window.beacon.watchlist.list())
    } catch {
      // A local list that cannot be read is empty for this run, not deleted.
    }
  }, [])

  // Signing out clears the stored session, the cached rows and the prefilled
  // address, so a shared Deck does not hand the next person the last account.
  // The watchlist is not a credential and is only deleted when asked for.
  const signOut = useCallback(async () => {
    setRailOpen(false)
    setSignOutPrompt(false)
    await window.beacon.auth.signOut().catch(() => {})
    try {
      window.localStorage.removeItem('beacon.email')
    } catch {
      // Storage can be unavailable; the session itself is already gone.
    }
    setSignedIn(false)
    reset({ name: 'login' })
    // Show the guest list, not the account's, if free videos are picked next.
    void loadWatchlist()
  }, [loadWatchlist, reset])

  const requestSignOut = useCallback(() => {
    if (!watchlist.items.length) {
      void signOut()
      return
    }
    dialogReturn.current = getFocused()
    setSignOutPrompt(true)
  }, [signOut, watchlist.items.length])

  const cancelSignOut = useCallback(() => {
    setSignOutPrompt(false)
    const previous = dialogReturn.current
    if (previous?.isConnected) setFocused(previous)
    else focusFirst()
  }, [])

  const deleteWatchlistAndSignOut = useCallback(async () => {
    setSignOutPrompt(false)
    // Clear before signing out: the main process files the list under the
    // address in the session that is about to be dropped.
    await window.beacon.watchlist
      .clear()
      .then(setWatchlist)
      .catch(() => {})
    await signOut()
  }, [signOut])

  const toggleWatchlist = useCallback(
    (card: Card) => {
      const saved = isWatchlisted(watchlist.items, card.kind, card.slug)
      const update = saved
        ? window.beacon.watchlist.remove(card.kind, card.slug)
        : window.beacon.watchlist.add(card)
      update.then(setWatchlist).catch(() => {})
    },
    [watchlist.items]
  )

  const moveWatchlist = useCallback((rowsAbove: number) => {
    window.beacon.watchlist.setPosition(rowsAbove).then(setWatchlist).catch(() => {})
  }, [])

  // The rail is only focusable while open, so focus it once it is on screen.
  // Queried directly rather than through focusFirst(): that helper skips
  // elements whose computed visibility is hidden, which is exactly what the
  // rail is mid-transition.
  useEffect(() => {
    if (!railOpen) return
    const item = openRailElement()?.querySelector<HTMLElement>('[data-focus]')
    if (item) setFocused(item)
  }, [railOpen])

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      try {
        const [status, slug] = await Promise.all([
          window.beacon.auth.status(),
          window.beacon.app.initialSlug()
        ])
        // Read the list only after status(): a rejected token signs the member
        // out inside status(), and the local list must follow the account that
        // is actually active, not the one whose tokens just failed.
        const list = await window.beacon.watchlist.list().catch(() => EMPTY_WATCHLIST)
        if (cancelled) return
        setSignedIn(status.signedIn)
        setWatchlist(list)
        const home: Route = status.signedIn ? { name: 'home' } : { name: 'login' }
        if (slug) {
          setStack([
            { id: nextId.current++, route: home },
            { id: nextId.current++, route: { name: 'content', slug } }
          ])
        } else {
          reset(home)
        }
      } catch {
        if (!cancelled) reset({ name: 'login' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [reset])

  useInput((action) => {
    if (player) {
      playerRef.current?.handle(action)
      return
    }

    // The dialog is modal: nothing behind it may take a move or a press.
    if (signOutPrompt) {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        move(action, document.querySelector<HTMLElement>('.dialog') ?? undefined)
        return
      }
      if (action === 'accept') {
        const active = document.activeElement as HTMLElement | null
        active?.click()
        return
      }
      if (action === 'back') cancelSignOut()
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
          // Up and down stay inside the rail. Sign out sits at the foot of the
          // screen, so without a scope the nearer rows behind the rail would
          // take the press and the account action would be unreachable.
          move(action, openRailElement() ?? undefined)
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
              // The session now names the account, so swap in its list.
              void loadWatchlist()
              reset({ name: 'home' })
            }}
            onSkip={() => reset({ name: 'home' })}
          />
        )
      case 'home':
        return (
          <Home
            onOpen={openCard}
            onPlay={playCard}
            refreshKey={progressVersion}
            watchlist={watchlist.items}
            rowsAbove={watchlist.rowsAbove}
            onToggleWatchlist={toggleWatchlist}
            onMoveWatchlist={moveWatchlist}
          />
        )
      case 'collection':
        return (
          <Collection
            slug={route.slug}
            onOpen={openCard}
            refreshKey={progressVersion}
            onToggleWatchlist={toggleWatchlist}
            inWatchlist={isWatchlisted(watchlist.items, 'series', route.slug)}
          />
        )
      case 'content':
        return (
          <Content
            slug={route.slug}
            onOpen={openCard}
            onPlay={play}
            refreshKey={progressVersion}
            onWatchedChanged={watchedChanged}
            onToggleWatchlist={toggleWatchlist}
            inWatchlist={isWatchlisted(watchlist.items, 'video', route.slug)}
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
        onSignOut={signedIn ? requestSignOut : undefined}
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

      {signOutPrompt ? (
        <ConfirmDialog
          title="Delete your watchlist?"
          message="Your watchlist is kept on this device, not in your Beacon account. You can keep it for next time, or delete it now."
          actions={[
            {
              label: 'Keep and sign out',
              onSelect: signOut,
              variant: 'primary',
              testId: 'keep-watchlist'
            },
            {
              label: 'Delete and sign out',
              onSelect: deleteWatchlistAndSignOut,
              variant: 'danger',
              testId: 'delete-watchlist'
            },
            { label: 'Cancel', onSelect: cancelSignOut, testId: 'cancel-signout' }
          ]}
        />
      ) : null}

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
