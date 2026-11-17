import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, FavouritesAnchor, FavouritesData, HomeData, UpdateInfo } from '@shared/types'
import { isFavourite, optimisticItem } from '@shared/favourites'
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
import { UpdateDialog, type UpdatePrompt } from './components/UpdateDialog'
import { Spinner } from './components/ui'
import { cleanError } from './lib/errors'

type Route =
  | { name: 'login' }
  /** `feed` carries a home feed fetched while the sign-in panel was up. */
  | { name: 'home'; feed?: HomeData }
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

const EMPTY_FAVOURITES: FavouritesData = { items: [], after: null }

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
  /** Signing out drops the stored session, so the rail asks before doing it. */
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const dialogReturn = useRef<HTMLElement | null>(null)
  const [favourites, setFavourites] = useState<FavouritesData>(EMPTY_FAVOURITES)
  /** Slugs with a favourite write in flight, so the button can show a spinner. */
  const [pendingFavourites, setPendingFavourites] = useState<ReadonlySet<string>>(new Set())
  /** Orders writes and replies: only the newest one may replace the row. */
  const favouriteSeq = useRef(0)
  const pendingCounts = useRef(new Map<string, number>())
  // Bumped when the player closes. What is behind it has just learned about
  // progress it did not have when its data was built, and screens stay mounted
  // while the player is open, so nothing else would refresh them.
  const [progressVersion, setProgressVersion] = useState(0)
  /** The running version, read once: it cannot change while the app is open. */
  const [version, setVersion] = useState<string | null>(null)
  /** `checking` is shown in the rail; the rest open the dialog. */
  const [update, setUpdate] = useState<UpdatePrompt | { name: 'checking' } | null>(null)
  /** The last check that found a newer release, so the rail can offer it again. */
  const [knownUpdate, setKnownUpdate] = useState<UpdateInfo | null>(null)
  const updateReturn = useRef<HTMLElement | null>(null)

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

  const openLogin = useCallback(() => {
    push({ name: 'login' })
  }, [push])

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
   * Read the account's favourites. Signed out, there is nothing to read: the
   * list lives in Beacon, not on this device. Any write still in flight belongs
   * to the session being replaced, so its answer is ignored from here on.
   */
  const loadFavourites = useCallback(async () => {
    const seq = ++favouriteSeq.current
    try {
      const data = await window.beacon.favourites.list()
      if (seq === favouriteSeq.current) setFavourites(data)
    } catch {
      // A network hiccup must not look like "you have no favourites"; the next
      // screen load reads again.
    }
  }, [])

  const trackPending = useCallback((slug: string, delta: number) => {
    const counts = pendingCounts.current
    const next = Math.max(0, (counts.get(slug) ?? 0) + delta)
    if (next > 0) counts.set(slug, next)
    else counts.delete(slug)
    setPendingFavourites(new Set(counts.keys()))
  }, [])

  // Signing out clears the stored session, the cached rows and the prefilled
  // address, so a shared Deck does not hand the next person the last account.
  // Favourites belong to the account and are left alone.
  const signOut = useCallback(async () => {
    setRailOpen(false)
    setConfirmSignOut(false)
    await window.beacon.auth.signOut().catch(() => {})
    try {
      window.localStorage.removeItem('beacon.email')
    } catch {
      // Storage can be unavailable; the session itself is already gone.
    }
    setSignedIn(false)
    reset({ name: 'login' })
    pendingCounts.current.clear()
    setPendingFavourites(new Set())
    // There is no guest list to fall back to; this empties the row.
    void loadFavourites()
  }, [loadFavourites, reset])

  // The account action sits beside browsing, where a stray press would end the
  // session; confirm it and come back to the same rail item if it is refused.
  const requestSignOut = useCallback(() => {
    dialogReturn.current = getFocused()
    setConfirmSignOut(true)
  }, [])

  const cancelSignOut = useCallback(() => {
    setConfirmSignOut(false)
    const previous = dialogReturn.current
    if (previous?.isConnected) setFocused(previous)
    else focusFirst()
  }, [])

  // Read once: the rail shows it, and it never changes while the app is open.
  // A failure costs only the version line, not the boot.
  useEffect(() => {
    void window.beacon.app
      .version()
      .then(setVersion)
      .catch(() => {})
  }, [])

  const checkForUpdates = useCallback(async () => {
    // The rail already names a release; show it again rather than spend
    // another round trip on the same answer.
    if (knownUpdate) {
      setUpdate({
        name: 'available',
        current: knownUpdate.current,
        latest: knownUpdate.latest,
        canInstall: knownUpdate.canInstall
      })
      return
    }
    setUpdate({ name: 'checking' })
    try {
      const info = await window.beacon.updates.check()
      if (!info.available) {
        setKnownUpdate(null)
        setUpdate({ name: 'current', version: info.current })
        return
      }
      setKnownUpdate(info)
      setUpdate({
        name: 'available',
        current: info.current,
        latest: info.latest,
        canInstall: info.canInstall
      })
    } catch (error) {
      setUpdate({ name: 'failed', stage: 'check', reason: cleanError(error) })
    }
  }, [knownUpdate])

  const requestUpdateCheck = useCallback(() => {
    if (
      update?.name === 'checking' ||
      update?.name === 'installing' ||
      update?.name === 'restarting'
    ) {
      return
    }
    updateReturn.current = getFocused()
    void checkForUpdates()
  }, [checkForUpdates, update?.name])

  const installUpdate = useCallback(async () => {
    if (!knownUpdate) return
    setUpdate({ name: 'installing', latest: knownUpdate.latest })
    try {
      // The main process downloads, verifies and swaps the AppImage in, then
      // schedules a relaunch. This window goes away on its own from here.
      await window.beacon.updates.install()
      setUpdate({ name: 'restarting', latest: knownUpdate.latest })
    } catch (error) {
      setUpdate({ name: 'failed', stage: 'install', reason: cleanError(error) })
    }
  }, [knownUpdate])

  const retryUpdate = useCallback(() => {
    if (update?.name === 'failed' && update.stage === 'install') void installUpdate()
    else void checkForUpdates()
  }, [update, installUpdate, checkForUpdates])

  const closeUpdate = useCallback(() => {
    setUpdate(null)
    const previous = updateReturn.current
    // The rail may have been dismissed while the check ran; its buttons are
    // inert then, so hand focus back to the screen instead.
    if (previous?.isConnected && !previous.closest('[inert]')) setFocused(previous)
    else focusFirst()
  }, [])

  const toggleFavourite = useCallback(
    (card: Card) => {
      if (!signedIn || card.kind !== 'series') return
      const saved = isFavourite(favourites.items, card.slug)
      // Change what is on screen now: the button and the row must not wait for
      // a round trip. The account's answer replaces this when it arrives.
      setFavourites((current) => {
        const items = current.items.filter((item) => item.slug !== card.slug)
        if (saved) return { ...current, items }
        const item = optimisticItem(card)
        return item ? { ...current, items: [item, ...items] } : current
      })
      const seq = ++favouriteSeq.current
      trackPending(card.slug, 1)
      const update = saved
        ? window.beacon.favourites.remove(card.slug)
        : window.beacon.favourites.add(card)
      update
        .then((next) => {
          if (seq === favouriteSeq.current) setFavourites(next)
        })
        .catch(() => {
          // The write failed, so the optimistic state was a lie. Re-read the
          // account rather than guessing what to undo.
          if (seq === favouriteSeq.current) void loadFavourites()
        })
        .finally(() => trackPending(card.slug, -1))
    },
    [favourites.items, signedIn, trackPending, loadFavourites]
  )

  const moveFavourites = useCallback((after: FavouritesAnchor) => {
    window.beacon.favourites
      .setPosition(after)
      .then(setFavourites)
      .catch(() => {})
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
        // out inside status(), and the favourites must follow the account that
        // is actually active, not the one whose tokens just failed.
        const list = await window.beacon.favourites.list().catch(() => EMPTY_FAVOURITES)
        if (cancelled) return
        setSignedIn(status.signedIn)
        setFavourites(list)
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

    // The confirmation is modal: nothing behind it may take a move or a press.
    if (confirmSignOut) {
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

    // The update dialog is modal as well. Installing has no cancel: the file
    // is on its way in and the app restarts, so a press must not land behind
    // the backdrop while that happens.
    if (update) {
      if (update.name === 'installing' || update.name === 'restarting') return
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        move(action, document.querySelector<HTMLElement>('.dialog') ?? undefined)
        return
      }
      if (action === 'accept') {
        const active = document.activeElement as HTMLElement | null
        active?.click()
        return
      }
      if (action === 'back') closeUpdate()
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
        // Nothing left to go back to: the first screen is also the way out.
        if (stack.length <= 1) {
          void window.beacon.app.quit()
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

  // A login opened from a locked page sits on top of it. After signing in, go
  // back to that page (and refresh it) rather than dropping the viewer on Home.
  const loginReturn =
    stack.length > 1 && stack[stack.length - 1].route.name === 'login'
      ? stack[stack.length - 2].route.name
      : null
  const returnsToScreen = loginReturn === 'content' || loginReturn === 'collection'

  if (!current) {
    return (
      <div className="screen screen--center">
        <Spinner label="Loading Beacon" />
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
              // The session now names the account, so swap in its favourites.
              void loadFavourites()
              // A locked page underneath was waiting for this account: refresh
              // it and stay there instead of dropping the viewer on Home.
              setProgressVersion((version) => version + 1)
              if (returnsToScreen) {
                back()
                return
              }
              // Fetch the first feed while the form is still up, then replace
              // the form with the finished screen. Otherwise the app blinks
              // through a second full-screen spinner on the way to Home.
              return window.beacon.catalog
                .home()
                .then((feed) => reset({ name: 'home', feed }))
                .catch(() => reset({ name: 'home' }))
            }}
            onSkip={() => {
              if (returnsToScreen) back()
              else reset({ name: 'home' })
            }}
          />
        )
      case 'home':
        return (
          <Home
            onOpen={openCard}
            onPlay={playCard}
            refreshKey={progressVersion}
            initial={route.feed}
            favourites={favourites.items}
            favouritesAfter={favourites.after}
            onToggleFavourite={signedIn ? toggleFavourite : undefined}
            onMoveFavourites={moveFavourites}
            pendingFavourites={pendingFavourites}
          />
        )
      case 'collection':
        return (
          <Collection
            slug={route.slug}
            onOpen={openCard}
            refreshKey={progressVersion}
            onToggleFavourite={signedIn ? toggleFavourite : undefined}
            inFavourites={isFavourite(favourites.items, route.slug)}
            favouritePending={pendingFavourites.has(route.slug)}
          />
        )
      case 'content':
        return (
          <Content
            slug={route.slug}
            onOpen={openCard}
            onPlay={play}
            onSignIn={openLogin}
            refreshKey={progressVersion}
            onWatchedChanged={watchedChanged}
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
        version={version}
        availableVersion={knownUpdate?.latest ?? null}
        checking={update?.name === 'checking'}
        onCheckForUpdates={requestUpdateCheck}
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

      {confirmSignOut ? (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need to sign in again to watch member videos. Free videos stay available without an account."
          actions={[
            {
              label: 'Cancel',
              onSelect: cancelSignOut,
              variant: 'primary',
              testId: 'cancel-signout'
            },
            {
              label: 'Sign out',
              onSelect: () => void signOut(),
              variant: 'danger',
              testId: 'confirm-signout'
            }
          ]}
        />
      ) : null}

      {update && update.name !== 'checking' ? (
        // Keyed by state so a new prompt gets its own first action focused.
        <UpdateDialog
          key={update.name}
          prompt={update}
          onClose={closeUpdate}
          onInstall={() => void installUpdate()}
          onRetry={retryUpdate}
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
