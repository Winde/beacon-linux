import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card, FavouritesAnchor, FavouritesData, HomeData, UpdateInfo } from '@shared/types'
import { isFavourite, optimisticItem } from '@shared/favourites'
import { useInput } from './input/useInput'
import { focusFirst, getFocused, move, setFocused } from './nav/focus'
import { Home } from './screens/Home'
import { Browse } from './screens/Browse'
import { Login } from './screens/Login'
import { Collection } from './screens/Collection'
import { Content } from './screens/Content'
import { Search } from './screens/Search'
import { Player, type PlayerHandle } from './screens/Player'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NavRail } from './components/NavRail'
import { UpdateDialog, type UpdatePrompt } from './components/UpdateDialog'
import { DelayedSpinner } from './components/ui'
import { cleanError } from './lib/errors'
import { pageCache } from './lib/pages'

export type Route =
  | { name: 'login' }
  /** `feed` carries a home feed fetched while the sign-in panel was up. */
  | { name: 'home'; feed?: HomeData }
  /** `card` is the tile that opened the page, used to paint its header first. */
  | { name: 'collection'; slug: string; card?: Card }
  | { name: 'content'; slug: string; card?: Card }
  | { name: 'browse' }
  | { name: 'search' }

export interface Entry {
  id: number
  route: Route
}

/**
 * Move up from an episode to the collection it belongs to.
 *
 * When the collection is the screen immediately behind the episode, pop back to
 * it. That is the case where "View series" would otherwise push a second copy
 * of the page the viewer just came from, and Back would walk straight into the
 * same episode/series cycle.
 *
 * Otherwise keep the episode in history and put the collection on top, so Back
 * returns to the episode. If an older copy of that collection is already deeper
 * in the stack, remove it first: a series page opened from Home, then buried by
 * Search, must not end up duplicated when the viewer reaches one of its episodes
 * through search.
 */
export function upToCollection(
  stack: Entry[],
  slug: string,
  nextId: () => number,
  card?: Card
): Entry[] {
  const previous = stack[stack.length - 2]
  if (previous?.route.name === 'collection' && previous.route.slug === slug) {
    return stack.slice(0, -1)
  }

  const withoutExisting = stack.filter(
    (entry) => !(entry.route.name === 'collection' && entry.route.slug === slug)
  )
  return [...withoutExisting, { id: nextId(), route: { name: 'collection', slug, card } }]
}

/**
 * The rail while it is open. Navigation is confined to it: the rail covers the
 * screen, so the rows behind it must not win a d-pad move.
 */
function openRailElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.rail.is-open')
}

/** The mounted page for one stack entry. Hidden routes remain queryable. */
function routeElement(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-route-id="${id}"]`)
}

const EMPTY_FAVOURITES: FavouritesData = { items: [], after: null }

export default function App(): React.JSX.Element {
  const [stack, setStack] = useState<Entry[]>([])
  const [player, setPlayer] = useState<{ slug: string; startAt?: number } | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const nextId = useRef(0)
  /** What was focused on each page, so Back can put the highlight back. */
  const focusByRoute = useRef(new Map<number, HTMLElement>())
  /** Route ids the last render had, to tell a return from a new page. */
  const seenRoutes = useRef<number[]>([])
  const activeRouteId = useRef<number | null>(null)
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
  /** When the Favourites row was last read, so focus does not duplicate boot. */
  const favouritesLoadedAt = useRef(0)
  /** A read is already in flight; focus must not start a second one. */
  const favouritesLoading = useRef(false)
  // Bumped when the player closes. What is behind it has just learned about
  // progress it did not have when its data was built, and screens stay mounted
  // while the player is open, so nothing else would refresh them.
  const [progressVersion, setProgressVersion] = useState(0)
  /** The running version, read once: it cannot change while the app is open. */
  const [version, setVersion] = useState<string | null>(null)
  /** A guest's last feed, kept for Skip so Home paints before the request. */
  const bootFeed = useRef<HomeData | null>(null)
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
      if (card.kind === 'series') push({ name: 'collection', slug: card.slug, card })
      else push({ name: 'content', slug: card.slug, card })
    },
    [push]
  )

  /** The episode page's series link is an "up" move, not a new stack level. */
  const openSeriesUp = useCallback((slug: string, card?: Card) => {
    setStack((current) => upToCollection(current, slug, () => nextId.current++, card))
  }, [])

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

  const openBrowse = useCallback(() => {
    setRailOpen(false)
    const top = stack[stack.length - 1]
    if (top?.route.name !== 'browse') push({ name: 'browse' })
  }, [push, stack])

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
    favouritesLoading.current = true
    try {
      const data = await window.beacon.favourites.list()
      if (seq === favouriteSeq.current) {
        setFavourites(data)
        favouritesLoadedAt.current = Date.now()
      }
    } catch {
      // A network hiccup must not look like "you have no favourites"; the next
      // screen load reads again.
    } finally {
      // A newer load owns the flag; only let the current one clear it.
      if (seq === favouriteSeq.current) favouritesLoading.current = false
    }
  }, [])

  /**
   * Another client can change favourites at any time. Focus and reconnect are
   * the reconciliation points, but a boot read already running, or one just
   * taken, is not repeated for a quick alt-tab.
   */
  const refreshFavourites = useCallback(() => {
    if (favouritesLoading.current) return
    if (Date.now() - favouritesLoadedAt.current < 10_000) return
    void loadFavourites()
  }, [loadFavourites])

  /**
   * Confirm the stored session with the account, after the first screen is
   * already up. A rejected token still means the sign-in screen; everything
   * else keeps the optimistic view and costs no extra render.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      const status = await window.beacon.auth.status()
      if (!status.signedIn) {
        // Invalidate a favourite read that may still be in flight for the
        // account status() just signed out of.
        favouriteSeq.current += 1
        pageCache.clear()
        setSignedIn(false)
        setFavourites(EMPTY_FAVOURITES)
        // Anything behind the account screen still holds signed-in rows.
        setProgressVersion((version) => version + 1)
        // Replace the optimistic Home with Login, but keep a page the launch
        // was asked to open on top of it. Resetting the whole stack would drop
        // a --open deep link before it could show its sign-in prompt.
        setStack((current) => {
          const root = current[0]
          if (!root || root.route.name !== 'home') return current
          const login = { ...root, route: { name: 'login' as const } }
          if (current.length === 2 && current[1]?.route.name === 'content') {
            return [login, current[1]]
          }
          return [login]
        })
        return
      }
      setSignedIn(true)
    } catch {
      // A transport failure is not a sign-out; the next screen read decides.
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
    bootFeed.current = null
    pageCache.clear()
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
      update?.name === 'closing'
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
      // schedules a relaunch. This window goes away on its own from here; the
      // closing state tells the viewer to open the app again from Steam.
      await window.beacon.updates.install()
      setUpdate({ name: 'closing', latest: knownUpdate.latest })
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
    // The move is newer than any list already in flight; do not let an older
    // answer put the row back where it was.
    const seq = ++favouriteSeq.current
    window.beacon.favourites
      .setPosition(after)
      .then((data) => {
        if (seq === favouriteSeq.current) setFavourites(data)
      })
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
        // The first screen is chosen from local data only: the stored session,
        // the last feed on disk, and any deep link. None of these touches the
        // network, so a slow `meMember` cannot hold the app on a spinner.
        const [session, slug, cached, cachedRow, pages] = await Promise.all([
          window.beacon.auth.session(),
          window.beacon.app.initialSlug(),
          window.beacon.catalog.cachedHome().catch(() => null),
          window.beacon.favourites.cached().catch(() => null),
          window.beacon.catalog.cachedPages().catch(() => null)
        ])
        if (cancelled) return
        // Fill the screen cache before the first route renders, so a deep link
        // or a page reopened after a relaunch can paint on its first frame.
        if (pages) pageCache.load(pages)
        setSignedIn(session.signedIn)
        // Both halves of Home come from the same cached slot, so the
        // Favourites row does not pop in after the first paint.
        setFavourites(session.signedIn && cachedRow ? cachedRow : EMPTY_FAVOURITES)
        // An account's cached feed is only ever used for that account. A
        // guest's may be reused by Skip, which lands on the same content.
        bootFeed.current = session.signedIn ? null : cached
        const home: Route = session.signedIn
          ? { name: 'home', feed: cached ?? undefined }
          : { name: 'login' }
        if (slug) {
          setStack([
            { id: nextId.current++, route: home },
            { id: nextId.current++, route: { name: 'content', slug } }
          ])
        } else {
          reset(home)
        }
        // The account check and the Favourites refresh run behind the screen.
        // The list is cached above; starting it now means the first launch
        // after an upgrade fills that cache rather than waiting on status().
        // A rejected account bumps the sequence in refreshSession(), which
        // discards any list that was still in flight for it.
        void loadFavourites()
        void refreshSession()
      } catch {
        if (!cancelled) reset({ name: 'login' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [loadFavourites, refreshSession, reset])

  /**
   * Pages stay mounted, so their scroll position survives Back, but their DOM
   * focus does not: hiding a route clears it. Remember the last focus on each
   * page and put it back when that page returns, or Back leaves the viewer on a
   * screen with no highlight and an A press that does nothing.
   */
  useLayoutEffect(() => {
    const activeId = stack[stack.length - 1]?.id ?? null
    const previousId = activeRouteId.current
    const known = seenRoutes.current

    if (activeId !== previousId) {
      const focused = getFocused()
      const previousRoute = previousId === null ? null : routeElement(previousId)
      if (
        previousId !== null &&
        previousRoute &&
        focused?.isConnected &&
        previousRoute.contains(focused)
      ) {
        focusByRoute.current.set(previousId, focused)
      }

      if (activeId !== null) {
        const activeRoute = routeElement(activeId)
        const saved = focusByRoute.current.get(activeId)
        if (activeRoute && saved?.isConnected && activeRoute.contains(saved)) {
          setFocused(saved)
        } else if (activeRoute && known.includes(activeId)) {
          // The old target left the page while it was hidden. Give the
          // returning screen a valid starting point instead of no focus at all.
          focusFirst(undefined, activeRoute)
        }
      }
      activeRouteId.current = activeId
    }

    seenRoutes.current = stack.map((entry) => entry.id)
    const present = new Set(seenRoutes.current)
    for (const id of focusByRoute.current.keys()) {
      if (!present.has(id)) focusByRoute.current.delete(id)
    }
  }, [stack])

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

    // The update dialog is modal as well. Installing and closing have no
    // cancel: the file is on its way in and the app is about to quit, so a
    // press must not land behind the backdrop.
    if (update) {
      if (update.name === 'installing' || update.name === 'closing') return
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
        <DelayedSpinner label="Loading Beacon" />
      </div>
    )
  }

  const renderRoute = (route: Route): React.JSX.Element | null => {
    switch (route.name) {
      case 'login':
        return (
          <Login
            onSignedIn={() => {
              bootFeed.current = null
              // Pages cached for the guest or the previous account must not
              // appear under the account that just signed in.
              pageCache.clear()
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
              else reset({ name: 'home', feed: bootFeed.current ?? undefined })
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
            onRevalidate={refreshFavourites}
          />
        )
      case 'collection':
        return (
          <Collection
            slug={route.slug}
            card={route.card}
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
            card={route.card}
            onOpen={openCard}
            onOpenSeries={openSeriesUp}
            onPlay={play}
            onSignIn={openLogin}
            refreshKey={progressVersion}
            onWatchedChanged={watchedChanged}
          />
        )
      case 'search':
        return <Search onOpen={openCard} />
      case 'browse':
        return <Browse onOpen={openCard} />
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
        onBrowse={openBrowse}
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
          data-route-id={entry.id}
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
