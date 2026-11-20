import { net } from 'electron'
import type {
  AuthStatus,
  CachedPages,
  Card,
  CollectionData,
  ContentData,
  FavouritesData,
  HomeData,
  NextEpisode,
  NextEpisodeRequest,
  PlaybackData,
  PlaybackKind,
  Row,
  SearchData,
  SessionInfo,
  WatchState
} from '@shared/types'
import { loadSession, saveSession, type Session } from './session'
import { TtlCache } from './cache'
import * as Q from './queries'
import { displayTitle, episodeCode, imageUrl as img } from './text'
import type { IndexedCollection, IndexedVideo } from './catalog-types'
import { WatchMarkStore, type WatchMark } from './watchmarks'
import { accountKey } from './account'
import { BATCH_SIZE, ProgressQueue, type QueuedEvent } from './progress-queue'
import { captionsOf, closingStretch, indexedVideoCard, minutes, videoCard } from './cards'
import type { CmsCard, ProgressInfo } from './cms-types'
import { buildHome } from './home'
import { PLATFORM } from './platform'
import type { HomeStore } from '../home-store'
import type { PageStore } from '../page-store'

const CMS_URL = 'https://critrole-beacon-production-backend.clockhosting.com/api/graphql'
const OAUTH_URL = 'https://pocketbeacon.memberful.com/oauth/token'
/** beacon.tv's own public Memberful client. */
const CLIENT_ID = '3Wdgxb5im239JhTBhS7KczZn'

const LEVEL_TTL = 10 * 60 * 1000
/** How long a screen may wait for progress writes before reading anyway. */
const REPORT_WAIT = 5_000
/** The app's own client flushes progress on this interval. */
const FLUSH_EVERY = 20_000
/** A CMS or token request that hangs must not hold a screen open forever. */
const API_TIMEOUT = 30_000

export class BeaconError extends Error {
  status?: number
  rejected?: boolean
}

/** The `meMember` fields this client reads. */
interface Member {
  user?: {
    username?: string
    activeSubscription?: boolean
    tier?: { name?: string; planLevel?: number } | null
  }
}

/** The parts of the catalog index this client needs. */
export interface CatalogLike {
  ensure(): Promise<void>
  refresh(): Promise<void>
  videoBySlug(slug: string): IndexedVideo | null
  collectionBySlug(slug: string): IndexedCollection | null
  videoById(id: string): IndexedVideo | null
  collectionById(id: string): IndexedCollection | null
  seriesVideos(seriesId: string): IndexedVideo[]
  localSearch(
    q: string,
    limit?: number
  ): { collections: IndexedCollection[]; videos: IndexedVideo[] }
  suggest(q: string, limit?: number): string[]
}

/**
 * A title leaves "Continue watching" once it is past this share of its runtime
 * and only this little remains. The share alone misjudges long episodes: 92%
 * of a four-hour episode still has nineteen minutes left to play.
 */
const FINISHED_SHARE = 92
const FINISHED_TAIL = 5 * 60 // seconds

/** A position this close to the mark's own point is the same point, not a watch. */
const MARK_SLACK_SECONDS = 10

/**
 * How many launches may re-send one mark. Beacon drops a point it does not like
 * without saying so, and a mark whose episode never moves would otherwise be
 * retried at every launch forever. Only a send that reached Beacon counts; a
 * launch that was offline does not spend the budget. After this many, the mark
 * is no longer re-queued, but a screen or launch read can still confirm it or
 * drop it when the server has moved on.
 */
export const MARK_RETRIES = 3

/**
 * What a hand-made "watched" mark reports. The CMS silently drops a near-end
 * report at 98% or more (it reads as a finished view, and Beacon stores no
 * finished flag), so the last second is reported as 97%: still inside the
 * closing stretch for every reader, but below the cutoff that gets discarded.
 */
const WATCHED_PERCENT = 97

/**
 * A stored position this far into the closing stretch is not worth resuming:
 * the player would open on the credits. Same two-part rule, with a tighter
 * tail, so a long episode watched to 96% keeps its point.
 */
const RESUME_SHARE = 95
const RESUME_TAIL = 3 * 60 // seconds
/** A position this close to the start is not worth offering as a resume. */
const RESUME_MIN = 5 // seconds

/**
 * The CMS answered with no such page. This is our own conclusion from an empty
 * result (`Contents.docs` / a catalog lookup), not an error code the API sends:
 * a missing slug is HTTP 200 with an empty list. The IPC layer turns it into
 * `null`, so the renderer never has to inspect an error message.
 */
class PageMissing extends Error {}

export class BeaconClient {
  // Loaded once, on first use and after the app is ready: safeStorage needs that,
  // and this class is constructed at module load, before it.
  private sessionState: Session | null | undefined = undefined
  private sessionLoad: Promise<Session | null> | null = null
  private refreshing: Promise<string | null> | null = null
  /** One `meMember` query, shared by account status and the feed's tier read. */
  private memberLoad: Promise<Member | null> | null = null
  /** The answer stays useful for a while; the tier changes even less often. */
  private memberCache: { at: number; value: Member | null } | null = null
  private level: { at: number; value: number } | null = null
  private sessionId = 'linux-' + Math.random().toString(36).slice(2, 10)
  /** Explicit marks, kept per account until real playback supersedes them. */
  private readonly watchmarks = new WatchMarkStore()
  /** In-flight favourite writes, keyed by collection id. */
  private readonly favouriteWrites = new Map<string, Promise<boolean>>()

  // Beacon answers the same questions over and over while a member browses,
  // and most answers stay right for minutes. The keys carry the account, and
  // everything is dropped when the account changes.
  private readonly homeCache = new TtlCache<string, HomeData>(60_000, 4)
  /**
   * The last feed on disk. Unlike the TTL cache above, this survives a quit,
   * which is what lets the next launch paint before the first request.
   */
  homeStore: HomeStore | null = null
  /**
   * The last collection and episode pages on disk. Unlike the TTL caches above,
   * this survives a quit; the request cache still decides when to revalidate.
   */
  pageStore: PageStore | null = null
  /** Bumped when the account changes, so an old fetch cannot write the slot. */
  private authGeneration = 0
  /** Bumped when progress or a watch mark makes the cached feed old. */
  private feedGeneration = 0
  /**
   * Five minutes: series cards show progress, so a shorter freshness window is
   * more accurate. Expiry only means the page is revalidated; the saved copy
   * in `PageStore` is what keeps it on screen during that refresh.
   */
  private readonly collectionCache = new TtlCache<string, CollectionData>(5 * 60_000, 40)
  /** Ten minutes for the same reason; the saved copy outlives both windows. */
  private readonly contentCache = new TtlCache<string, ContentData>(10 * 60_000, 40)
  private readonly searchCache = new TtlCache<string, SearchData>(5 * 60_000, 30)
  private readonly playbackCache = new TtlCache<string, PlaybackData | null>(5 * 60_000, 40)
  private readonly progressCache = new TtlCache<string, Record<string, ProgressInfo>>(30_000, 30)
  /**
   * Progress leaves the player every ten seconds of playback, but reaches
   * Beacon in batches: ten events per mutation, flushed every twenty seconds
   * and before any read that would show the result. A send that fails or runs
   * offline stays on disk, so closing the app cannot lose the last position.
   */
  private readonly progressQueue = new ProgressQueue(undefined, () => {
    try {
      return typeof net.isOnline === 'function' ? net.isOnline() : true
    } catch {
      return true
    }
  })
  private flushTimer: ReturnType<typeof setInterval> | undefined

  /** What an entry belongs to: a member's rows and tier are not shared. */
  private async scope(): Promise<string> {
    const session = await this.currentSession()
    return session?.email ?? 'guest'
  }

  private clearCaches(): void {
    // A feed from the previous account must not survive sign-out or a switch,
    // even if the file delete fails: the read is scoped as well.
    this.authGeneration += 1
    this.memberLoad = null
    this.memberCache = null
    this.homeStore?.clear()
    this.pageStore?.clear()
    this.homeCache.clear()
    this.collectionCache.clear()
    this.contentCache.clear()
    this.searchCache.clear()
    this.playbackCache.clear()
    this.progressCache.clear()
  }

  private async currentSession(): Promise<Session | null> {
    if (this.sessionState !== undefined) return this.sessionState
    if (!this.sessionLoad) {
      this.sessionLoad = loadSession().then((session) => {
        this.sessionState = session
        // A queue left by the previous run still owes Beacon. Send it now,
        // rather than making the next launch wait out the timer; a failed
        // send starts the timer as usual. Then give any mark Beacon never
        // confirmed another chance, so a dropped write cannot stay on this
        // machine alone. Both are background work: a slow launch is worse
        // than a late mark.
        if (session) {
          // Snapshot here: these are the marks the previous run left
          // unconfirmed. A mark made during this run is already on its way.
          const carried = Object.keys(this.watchmarks.marks(session.email ?? null))
          void (async () => {
            await this.flushProgress().catch(() => false)
            if (carried.length) await this.reconcileMarks(carried)
          })().catch(() => {})
        }
        return session
      })
    }
    return this.sessionLoad
  }

  private async updateSession(session: Session | null): Promise<void> {
    this.sessionState = session
    await saveSession(session)
  }

  /** Set once the catalog index exists; search and "more from" need it. */
  catalog: CatalogLike | null = null

  async isSignedIn(): Promise<boolean> {
    const session = await this.currentSession()
    return Boolean(session?.accessToken && session.refreshToken)
  }

  /**
   * The stored session alone. No CMS call and no token refresh: the first
   * screen and the cache slot cannot wait on the network.
   */
  async session(): Promise<SessionInfo> {
    const session = await this.currentSession()
    return {
      signedIn: Boolean(session?.accessToken && session.refreshToken),
      email: session?.email ?? null
    }
  }

  /**
   * What local, per-account data is filed under. The address comes from the
   * session, so it is available without a CMS round trip and is still there
   * when the tokens are, until the member actually signs out.
   */
  async accountEmail(): Promise<string | null> {
    const session = await this.currentSession()
    return session?.email ?? null
  }

  // ---------- auth ----------

  private async tokenRequest(params: Record<string, string>): Promise<{
    access_token: string
    refresh_token?: string
    expires_in?: number
  }> {
    // Credentials go in the body, never the URL. Memberful answers 307 and
    // redirects to members.beacon.tv; a 307 carries the method and body along,
    // while a query string would be copied into the Location header and logged
    // by the proxy and both origins.
    const res = await net.fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT)
    })
    let body: Record<string, string> = {}
    try {
      body = (await res.json()) as Record<string, string>
    } catch {
      // not JSON
    }
    if (res.status >= 400 || !body.access_token) {
      const err = new BeaconError(
        body.error_description || body.error || `Sign-in failed (HTTP ${res.status})`
      )
      err.status = res.status
      err.rejected = res.status === 400 || res.status === 401
      throw err
    }
    return body as unknown as { access_token: string; refresh_token?: string; expires_in?: number }
  }

  async signIn(email: string, password: string): Promise<AuthStatus> {
    const address = email.trim()
    const body = await this.tokenRequest({
      grant_type: 'password',
      username: address,
      password
    })
    await this.updateSession({
      email: address,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? '',
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
    })
    this.level = null
    this.clearCaches()
    // Progress this account left behind while signed out is still owed.
    if (this.progressQueue.size(accountKey(address))) {
      void this.flushProgress().catch(() => {})
    }
    return this.status()
  }

  async signOut(): Promise<void> {
    // The queue is kept for this account and never sent with another token;
    // when the same member signs back in, its timer picks the events up again.
    this.stopFlushTimer()
    await this.updateSession(null)
    this.level = null
    this.clearCaches()
  }

  /**
   * The `meMember` answer, once per burst. The first screen no longer waits
   * for `status()`, so the account check and the feed's tier read now race;
   * they share this promise instead of asking the CMS the same question twice.
   */
  private member(): Promise<Member | null> {
    // A fast answer can beat the second caller to the promise, so the result
    // is kept briefly as well as shared while in flight.
    if (this.memberCache && Date.now() - this.memberCache.at < LEVEL_TTL) {
      return Promise.resolve(this.memberCache.value)
    }
    if (!this.memberLoad) {
      const generation = this.authGeneration
      const pending = this.gql<{ meMember?: Member }>(Q.ME)
        .then((r) => {
          const member = r.meMember ?? null
          // A sign-out while this was in flight must not refill the next
          // account's cache with the previous member's tier.
          if (generation === this.authGeneration) {
            this.memberCache = { at: Date.now(), value: member }
          }
          return member
        })
        .finally(() => {
          // Only retire our own entry: a sign-in may have put a new query here.
          if (this.memberLoad === pending) this.memberLoad = null
        })
      this.memberLoad = pending
    }
    return this.memberLoad
  }

  async status(): Promise<AuthStatus> {
    const session = await this.currentSession()
    if (!session) return { signedIn: false, user: null }
    const generation = this.authGeneration
    try {
      const member = await this.member()
      // The account may have changed while the query was in flight. Do not
      // report the previous member's name or tier, and do not repopulate the
      // level cache the sign-out just cleared.
      if (generation !== this.authGeneration) {
        const current = await this.currentSession()
        if (!current) return { signedIn: false, user: null }
        return {
          signedIn: true,
          user: { name: current.email || 'Member', tier: null, active: true }
        }
      }
      const user = member?.user
      // Home and the screens ask for the level straight after boot; this saves
      // a second ME query and answers it with what status() already learned.
      this.level = { at: Date.now(), value: user?.tier?.planLevel ?? 1 }
      return {
        signedIn: true,
        user: {
          name: user?.username || session.email || 'Member',
          tier: user?.tier?.name ?? null,
          active: Boolean(user?.activeSubscription)
        }
      }
    } catch (err) {
      // A rejected refresh token has already signed the member out, and a 401
      // from the CMS means the same. Only a transport failure keeps the session.
      const failure = err as BeaconError
      if (failure.status === 401 || failure.rejected) {
        await this.signOut()
        return { signedIn: false, user: null }
      }
      // A network blip should not look like a sign-out.
      return {
        signedIn: true,
        user: { name: session.email || 'Member', tier: null, active: true }
      }
    }
  }

  /** A valid access token, refreshed shortly before it expires. */
  private async accessToken(force = false): Promise<string | null> {
    const current = await this.currentSession()
    if (!current) return null
    if (!force && Date.now() < current.expiresAt - 60_000) return current.accessToken
    if (!this.refreshing) {
      this.refreshing = this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken
      })
        .then(async (body) => {
          const session = await this.currentSession()
          if (!session) return null
          const next: Session = {
            ...session,
            accessToken: body.access_token,
            refreshToken: body.refresh_token ?? session.refreshToken,
            expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
          }
          await this.updateSession(next)
          return next.accessToken
        })
        .catch(async (err) => {
          if ((err as BeaconError).rejected) await this.signOut()
          throw err
        })
        .finally(() => {
          this.refreshing = null
        })
    }
    return this.refreshing
  }

  // ---------- GraphQL ----------

  async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const attempt = async (n: number): Promise<T> => {
      const token = await this.accessToken(n > 0)
      const res = await net.fetch(CMS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform': PLATFORM,
          'x-supports-drm': 'false',
          'x-has-waiting-room': 'true',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(API_TIMEOUT)
      })
      if (res.status === 401 && token && n === 0) return attempt(1)
      const json = (await res.json().catch(() => ({}))) as {
        data?: T
        errors?: { message: string }[]
      }
      if (!json.data) {
        const err = new BeaconError(
          json.errors?.map((e) => e.message).join('; ') || `Beacon answered HTTP ${res.status}`
        )
        err.status = res.status
        throw err
      }
      return json.data
    }
    return attempt(0)
  }

  private async userLevel(): Promise<number> {
    if (!(await this.currentSession())) return 1
    if (this.level && Date.now() - this.level.at < LEVEL_TTL) return this.level.value
    const generation = this.authGeneration
    const member = await this.member().catch(() => null)
    const value = member?.user?.tier?.planLevel ?? 1
    // A level read that started before a sign-out must not refill the cache
    // for the account that just left.
    if (generation === this.authGeneration) this.level = { at: Date.now(), value }
    return value
  }

  private async watchMarks(): Promise<{
    email: string | null
    marks: Record<string, WatchMark>
  }> {
    const session = await this.currentSession()
    const email = session?.email ?? null
    return { email, marks: this.watchmarks.marks(email) }
  }

  /**
   * A video's state from what Beacon remembers and how long it runs. An
   * explicit mark wins, because Beacon accepts a progress write and then keeps
   * reporting the old point. Once Beacon's read agrees with the mark, or the
   * point has moved since the mark was made, the local copy is dropped so a
   * later watch on another device is not masked.
   */
  private effectiveWatch(
    id: string,
    durationMs: number | null | undefined,
    progress: number,
    position: number | null | undefined,
    email: string | null,
    marks: Record<string, WatchMark>
  ): WatchState {
    const watched = closingStretch(
      progress * 100,
      position,
      (durationMs ?? 0) / 1000,
      FINISHED_SHARE,
      FINISHED_TAIL
    )
    const mark = marks[id]
    if (!mark) return { progress, watched }
    // "Unwatched" also means the point is gone, so it converges only when the
    // server is back at the start, not merely below the finished threshold.
    if (this.markAgrees(mark, durationMs, progress, position)) {
      this.watchmarks.clear(email, id)
      return { progress, watched }
    }
    // The point moved after the member's choice, so a watch elsewhere is newer.
    if (this.markMovedSince(mark, progress, position)) {
      this.watchmarks.clear(email, id)
      return { progress, watched }
    }
    return { watched: mark.watched, progress: mark.watched ? 1 : 0 }
  }

  /**
   * The state a screen or the player should show for one video, plus whether
   * the member's own mark is still the thing deciding it. `effectiveWatch`
   * clears a mark that has been confirmed or superseded, so `marked` has to be
   * read after that call, never from the store before it.
   */
  private resolveWatch(
    id: string,
    durationMs: number | null | undefined,
    progress: number,
    position: number | null | undefined,
    email: string | null,
    marks: Record<string, WatchMark>
  ): WatchState & { marked: boolean } {
    const state = this.effectiveWatch(id, durationMs, progress, position, email, marks)
    return { ...state, marked: Boolean(marks[id]) }
  }

  /** Whether Beacon's own read has caught up with a hand-made mark. */
  private markAgrees(
    mark: WatchMark,
    durationMs: number | null | undefined,
    progress: number,
    position: number | null | undefined
  ): boolean {
    if (!mark.watched) {
      return progress <= 0.01 || (position != null && position > 0 && position <= RESUME_MIN)
    }
    return closingStretch(
      progress * 100,
      position,
      (durationMs ?? 0) / 1000,
      FINISHED_SHARE,
      FINISHED_TAIL
    )
  }

  /**
   * Whether Beacon's point has moved since the mark was made. A moved point
   * means somebody watched the title elsewhere after the member's choice, so
   * the mark is stale: it must neither mask the row nor be sent again.
   */
  private markMovedSince(
    mark: WatchMark,
    progress: number,
    position: number | null | undefined
  ): boolean {
    const base = mark.base
    if (!base) return false
    if (base.position != null && position != null) {
      return Math.abs(base.position - position) > MARK_SLACK_SECONDS
    }
    return Math.abs(base.progress - progress) > 0.01
  }

  /**
   * Whether a mark with no recorded point is still safe to assert. A watched
   * mark on an episode nobody had started only fills in a point that did not
   * exist; anything else may belong to a later watch on another device.
   */
  private markWithoutBaseIsSafe(mark: WatchMark, progress: number): boolean {
    return mark.watched && progress <= 0.01
  }

  async progressFor(ids: string[]): Promise<Record<string, ProgressInfo>> {
    if (!(await this.currentSession()) || !ids.length) return {}
    await this.settleReports()
    const unique = [...new Set(ids)]
    // The ids come from whichever rows are on screen, so sort them into a
    // stable key: two screens asking for the same set share the answer.
    const key = unique.slice().sort().join(',')
    return this.progressCache.load(key, () => this.loadProgress(unique))
  }

  private async loadProgress(ids: string[]): Promise<Record<string, ProgressInfo>> {
    return this.fetchProgress(ids).catch(() => ({}))
  }

  /** A progress read that fails loudly: a retry must not rest on an empty answer. */
  private async fetchProgress(ids: string[]): Promise<Record<string, ProgressInfo>> {
    const map: Record<string, ProgressInfo> = {}
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.gql<{
        getProgressForContent?: {
          timeMap?: { contentId: string; videoProgress?: number; videoProgressSeconds?: number }[]
        }
      }>(Q.PROGRESS_FOR, { ids: ids.slice(i, i + 100) })
      for (const p of r.getProgressForContent?.timeMap ?? []) {
        map[p.contentId] = {
          progress: Math.min(1, (p.videoProgress ?? 0) / 100),
          position: p.videoProgressSeconds ?? null
        }
      }
    }
    return map
  }

  // ---------- screens ----------

  /**
   * The feed for the first paint, scoped to the session in hand. A file that
   * belongs to another account (or an older schema) is deleted on the way out.
   */
  async cachedHome(): Promise<HomeData | null> {
    if (!this.homeStore) return null
    return this.homeStore.read(await this.scope())?.home ?? null
  }

  /** The Favourites row from the same slot, for the same first paint. */
  async cachedFavourites(): Promise<FavouritesData | null> {
    if (!this.homeStore) return null
    return this.homeStore.read(await this.scope())?.favourites ?? null
  }

  /**
   * Every collection and episode page the last launch kept for this account.
   * The renderer holds them in memory and paints one before asking the CMS.
   */
  async cachedPages(): Promise<CachedPages> {
    if (!this.pageStore) return { collections: [], contents: [] }
    return this.pageStore.readAll(await this.scope())
  }

  async home(): Promise<HomeData> {
    await this.settleReports()
    const key = await this.scope()
    // Captured after the flush: a queued progress write that just landed is
    // part of this read, not a reason to distrust it. A write during the read
    // is a reason not to save the answer.
    const generation = this.authGeneration
    const feedGeneration = this.feedGeneration
    const data = await this.homeCache.load(key, () =>
      buildHome({
        gql: (query, variables) => this.gql(query, variables),
        isSignedIn: () => this.isSignedIn(),
        userLevel: () => this.userLevel(),
        catalog: this.catalog,
        watchMarks: () => this.watchMarks(),
        watchState: (id, durationMs, progress, position, email, marks) =>
          this.effectiveWatch(id, durationMs, progress, position, email, marks)
      })
    )
    // A CMS hiccup must not be remembered as an empty home for a minute.
    if (!data.hero.length && !data.rows.length) this.homeCache.delete(key)
    // Only the account that asked for it may fill the slot, and only if no
    // progress write made this answer old while it was in flight.
    else if (generation === this.authGeneration && feedGeneration === this.feedGeneration) {
      this.homeStore?.saveHome(key, data)
    }
    return data
  }

  async collection(slug: string): Promise<CollectionData | null> {
    await this.settleReports()
    const scope = await this.scope()
    // A progress write during the read makes the page too old to keep, though
    // the caller still gets the answer it asked for.
    const generation = this.authGeneration
    const feedGeneration = this.feedGeneration
    try {
      const data = await this.collectionCache.load(`${scope}|${slug}`, () =>
        this.buildCollection(slug)
      )
      if (generation === this.authGeneration && feedGeneration === this.feedGeneration) {
        this.pageStore?.saveCollection(scope, data)
      }
      return data
    } catch (error) {
      // The series is gone from the CMS; a saved copy would only resurrect it.
      if (error instanceof PageMissing) {
        this.pageStore?.deleteCollection(scope, slug)
        return null
      }
      throw error
    }
  }

  private async buildCollection(slug: string): Promise<CollectionData> {
    await this.catalog?.ensure().catch(() => {})
    let known = this.catalog?.collectionBySlug(slug) ?? null
    // A home block can feature a collection newer than the catalog snapshot.
    if (!known) {
      try {
        await this.catalog?.refresh()
      } catch {
        // The index could not be refreshed, which says nothing about whether
        // the series exists. Keep the saved copy and let the screen report a
        // failed refresh instead of treating it as a deletion.
        throw new Error('Could not load series.')
      }
      known = this.catalog?.collectionBySlug(slug) ?? null
    }
    if (!known) throw new PageMissing('Series not found.')
    const level = await this.userLevel()
    const { email, marks } = await this.watchMarks()

    const toCards = async (docs: CmsCard[]): Promise<Card[]> => {
      const progress = await this.progressFor(docs.map((d) => d.id))
      return docs.map((d) => {
        const info = progress[d.id]
        return videoCard(
          d,
          level,
          this.effectiveWatch(d.id, d.duration, info?.progress ?? 0, info?.position, email, marks)
        )
      })
    }

    if (known.isSeries) {
      const first = await this.gql<{
        fetchSeries?: {
          docs?: { content?: CmsCard }[]
          collection?: { series?: { id: string; seasonNumber: number }[] }
        }
      }>(Q.SERIES, { collection: known.id, limit: 1000 })

      const seasons = (first.fetchSeries?.collection?.series ?? [])
        .slice()
        .sort((a, b) => a.seasonNumber - b.seasonNumber)

      const docsOf = (r: { docs?: { content?: CmsCard }[] } | undefined): CmsCard[] =>
        (r?.docs ?? []).map((d) => d.content).filter((c): c is CmsCard => Boolean(c))

      if (seasons.length <= 1) {
        return {
          id: known.id,
          slug,
          title: known.name,
          image: img(known.image ?? known.portrait, 1280),
          image2x: img(known.image2x, 1280),
          isSeries: true,
          seasons: [{ title: 'Episodes', items: await toCards(docsOf(first.fetchSeries)) }]
        }
      }

      const grouped = await Promise.all(
        seasons.map(async (s) => {
          const r = await this.gql<{ fetchSeries?: { docs?: { content?: CmsCard }[] } }>(Q.SERIES, {
            collection: known.id,
            season: s.id,
            limit: 1000
          })
          return { title: `Season ${s.seasonNumber}`, items: await toCards(docsOf(r.fetchSeries)) }
        })
      )
      return {
        id: known.id,
        slug,
        title: known.name,
        image: img(known.image ?? known.portrait, 1280),
        image2x: img(known.image2x, 1280),
        isSeries: true,
        seasons: grouped.filter((s) => s.items.length)
      }
    }

    const docs: CmsCard[] = []
    for (let page = 1, total = 1; page <= total && page <= 20; page++) {
      const r = await this.gql<{ search?: { totalPages?: number; docs?: CmsCard[] } }>(Q.SEARCH, {
        collection: known.id,
        types: Q.PLAYABLE,
        sort: '-releaseDate',
        page,
        limit: 100
      })
      total = r.search?.totalPages ?? 1
      docs.push(...(r.search?.docs ?? []))
    }

    return {
      id: known.id,
      slug,
      title: known.name,
      image: img(known.image ?? known.portrait, 1280),
      image2x: img(known.image2x, 1280),
      isSeries: false,
      seasons: [{ title: 'Videos', items: await toCards(docs) }]
    }
  }

  async content(slug: string): Promise<ContentData | null> {
    await this.settleReports()
    const scope = await this.scope()
    const generation = this.authGeneration
    const feedGeneration = this.feedGeneration
    try {
      const data = await this.contentCache.load(`${scope}|${slug}`, () => this.buildContent(slug))
      if (generation === this.authGeneration && feedGeneration === this.feedGeneration) {
        this.pageStore?.saveContent(scope, data)
      }
      return data
    } catch (error) {
      // The episode is gone from the CMS; drop the copy instead of painting it.
      if (error instanceof PageMissing) {
        this.pageStore?.deleteContent(scope, slug)
        return null
      }
      throw error
    }
  }

  private async buildContent(slug: string): Promise<ContentData> {
    const r = await this.gql<{
      Contents?: {
        docs?: (CmsCard & {
          description?: string
          continuedSummary?: string | null
          collections?: { id: string; name: string; slug: string; isSeries?: boolean }[]
          content?: { carouselContent?: CmsCard[] }[]
          contentVideo?: {
            video?: {
              video?: string
              videoData?: string
              closedCaptions?: string
            } | null
          } | null
          contentPodcast?: {
            podcast?: {
              source?: string | null
              audio?: string | null
              player?: string | null
              audioData?: string | null
            } | null
          } | null
        })[]
      }
      currentProgress?: { videoProgress?: number; videoProgressSeconds?: number } | null
    }>(Q.CONTENT, { slug })

    const doc = r.Contents?.docs?.[0]
    if (!doc) throw new PageMissing('Video not found.')

    this.catalog?.ensure().catch(() => {})
    const level = await this.userLevel()
    const signedIn = await this.isSignedIn()
    const { email, marks } = await this.watchMarks()
    const video = doc.contentVideo?.video
    const audio = doc.contentPodcast?.podcast?.audio
    const playable = Boolean(video?.video || audio)
    // A TV client watches the video when there is one. Audio is the fallback
    // for podcast-only items, not a second mode for a video item.
    const kind: PlaybackKind = video?.video || !audio ? 'video' : 'audio'
    // `primaryCollection` is the editor's main filing, but a few playable docs
    // (one-offs, live-show videos) only carry `collections`. Use the first one
    // as the page's category so those episodes still have an "up" link.
    const filed = doc.collections?.[0]
    const series =
      doc.primaryCollection ??
      (filed
        ? {
            id: filed.id,
            name: filed.name,
            slug: filed.slug,
            isSeries: Boolean(filed.isSeries)
          }
        : null)
    const rows: Row[] = []

    // Every row item's id and runtime, so one progress read can badge them all.
    const meta = new Map<string, { id: string; duration: number | null }>()
    const addMeta = (item: CmsCard): void => {
      meta.set(item.slug, { id: item.id, duration: item.duration ?? null })
    }
    addMeta(doc)

    if (series?.isSeries) {
      const next = await this.gql<{ fetchSeries?: { next?: CmsCard | null } }>(Q.SERIES, {
        collection: series.id,
        content: doc.id,
        limit: 1
      }).catch(() => null)
      const nextDoc = next?.fetchSeries?.next
      if (nextDoc) {
        addMeta(nextDoc)
        rows.push({ title: 'Next episode', items: [videoCard(nextDoc, level)] })
      }
    }

    const known = this.catalog?.videoBySlug(slug) ?? null
    const code = known ? episodeCode(known.title) : null
    if (code && this.catalog) {
      const versions = this.catalog
        .seriesVideos(known?.series?.id ?? '')
        .filter((v) => v.id !== known?.id && episodeCode(v.title) === code)
      if (versions.length) {
        for (const v of versions) meta.set(v.slug, { id: v.id, duration: v.duration })
        rows.push({
          title: 'Other versions',
          items: versions.map((v) => indexedVideoCard(v, level))
        })
      }
    }

    if (series && this.catalog) {
      const list = this.catalog.seriesVideos(series.id)
      const index = list.findIndex((v) => v.slug === slug)
      let around = index >= 0 ? list.slice(index + 1, index + 13) : []
      if (!around.length)
        around = list
          .filter((v) => v.slug !== slug)
          .slice(-12)
          .reverse()
      if (around.length) {
        for (const v of around) meta.set(v.slug, { id: v.id, duration: v.duration })
        rows.push({
          title: `More from ${series.name}`,
          items: around.map((v) => indexedVideoCard(v, level))
        })
      }
    }

    const suggested = (doc.content ?? [])
      .flatMap((b) => b?.carouselContent ?? [])
      .filter((c): c is CmsCard => Boolean(c))
    if (suggested.length) {
      for (const c of suggested) addMeta(c)
      rows.push({ title: 'Recommended', items: suggested.map((c) => videoCard(c, level)) })
    }

    const progress = await this.progressFor([...meta.values()].map((m) => m.id))
    for (const row of rows) {
      for (const item of row.items) {
        const entry = meta.get(item.slug)
        const info = entry ? progress[entry.id] : undefined
        const state = this.effectiveWatch(
          entry?.id ?? '',
          entry?.duration,
          info?.progress ?? 0,
          info?.position,
          email,
          marks
        )
        item.progress = state.progress
        item.watched = state.watched
      }
    }

    // The rows above read progress by content id; the page's own
    // `currentProgress` is a second read that can lag it. Use the same source
    // for the header button as for the tiles, so the same episode cannot show
    // a watched badge and offer "Mark as watched" at the same time. The page
    // read is the fallback when the id has no entry in the map.
    const cp = r.currentProgress
    const info = progress[doc.id]
    const docProgress = info ? info.progress : Math.min(1, (cp?.videoProgress ?? 0) / 100)
    const docPosition = info ? info.position : (cp?.videoProgressSeconds ?? null)
    // A mark means the member has said where this episode stands, whatever the
    // server still reports; if it is still in force, start from the beginning.
    // `marked` must come from the resolved state: `effectiveWatch` drops a mark
    // Beacon has confirmed or one a watch elsewhere superseded, and reading the
    // store before it would keep starting a part-watched episode over.
    const state = this.resolveWatch(doc.id, doc.duration, docProgress, docPosition, email, marks)
    const resumeFrom = docPosition ?? 0
    const resumeAt =
      !state.marked &&
      docPosition != null &&
      resumeFrom > RESUME_MIN &&
      !closingStretch(
        docProgress * 100,
        docPosition,
        (doc.duration ?? 0) / 1000,
        RESUME_SHARE,
        RESUME_TAIL
      )
        ? resumeFrom
        : 0

    // Play would ask the CMS for this same stream again a second later; hand
    // the player what this page already fetched.
    if (playable) {
      this.playbackCache.set(`${await this.scope()}|${slug}`, {
        id: doc.id,
        title: doc.title,
        kind,
        image: kind === 'audio' ? img(doc.thumbnail?.sizes?.square?.url, 960) : undefined,
        image2x: undefined,
        url: video?.video ?? audio!,
        playlist: null,
        duration: doc.duration ? Math.round(doc.duration / 1000) : null,
        resumeAt,
        captions: video ? captionsOf(video) : [],
        episodeNumber: doc.episodeNumber ?? null,
        collection: doc.primaryCollection
          ? { id: doc.primaryCollection.id, isSeries: Boolean(doc.primaryCollection.isSeries) }
          : null
      })
    }

    return {
      id: doc.id,
      slug,
      title: doc.title,
      description: doc.description ?? '',
      continuedSummary: doc.continuedSummary ?? '',
      image: img(doc.thumbnail?.sizes?.landscape?.url, 1280),
      image2x: img(doc.thumbnail?.sizes?.landscape2x?.url, 1280),
      minutes: minutes(doc.duration),
      released: doc.releaseDate ?? null,
      kind,
      series: series
        ? { slug: series.slug, title: series.name, isSeries: Boolean(series.isSeries) }
        : null,
      tier: doc.contentTier?.name ?? null,
      locked: !playable,
      signInNeeded: !playable && !signedIn,
      signedIn,
      watched: state.watched,
      resumeAt,
      rows
    }
  }

  async play(slug: string): Promise<PlaybackData | null> {
    await this.settleReports()
    const key = `${await this.scope()}|${slug}`
    return this.playbackCache.load(key, () => this.loadPlayback(slug))
  }

  private async loadPlayback(slug: string): Promise<PlaybackData | null> {
    const r = await this.gql<{
      Contents?: {
        docs?: {
          id: string
          title: string
          duration?: number | null
          episodeNumber?: number | null
          primaryCollection?: { id: string; isSeries?: boolean } | null
          thumbnail?: { sizes?: { square?: { url?: string } | null } | null } | null
          contentVideo?: {
            video?: { video?: string; videoData?: string; closedCaptions?: string } | null
          } | null
          contentPodcast?: { podcast?: { audio?: string | null } | null } | null
        }[]
      }
      currentProgress?: { videoProgress?: number; videoProgressSeconds?: number } | null
    }>(Q.MEDIA, { slug })

    const doc = r.Contents?.docs?.[0]
    const video = doc?.contentVideo?.video
    const audio = doc?.contentPodcast?.podcast?.audio
    if (!video?.video && !audio) return null
    const kind: PlaybackKind = video?.video ? 'video' : 'audio'

    const cp = r.currentProgress
    const runtimeSec = (doc?.duration ?? 0) / 1000
    const progress = Math.min(1, (cp?.videoProgress ?? 0) / 100)
    const position = cp?.videoProgressSeconds ?? null
    const { email, marks } = await this.watchMarks()
    // Resolve the mark exactly as the content page does, so a stale one is
    // dropped here too and cannot pin playback to the start of the episode.
    const state = this.resolveWatch(doc?.id ?? '', doc?.duration, progress, position, email, marks)
    return {
      id: doc?.id ?? '',
      title: doc?.title ?? '',
      kind,
      image: kind === 'audio' ? img(doc?.thumbnail?.sizes?.square?.url, 960) : undefined,
      url: video?.video ?? audio!,
      playlist: null,
      duration: doc?.duration ? Math.round(doc.duration / 1000) : null,
      resumeAt:
        !state.marked &&
        position != null &&
        position > RESUME_MIN &&
        !closingStretch(progress * 100, position, runtimeSec, RESUME_SHARE, RESUME_TAIL)
          ? position
          : 0,
      captions: video ? captionsOf(video) : [],
      episodeNumber: doc?.episodeNumber ?? null,
      collection: doc?.primaryCollection
        ? { id: doc.primaryCollection.id, isSeries: Boolean(doc.primaryCollection.isSeries) }
        : null
    }
  }

  /**
   * The episode to offer when this one ends, or null to let it end.
   *
   * Beacon answers `fetchSeries(...) { next }` with the next item in its own
   * order, which skips trailers filed inside a series and resolves two-part
   * episodes. The app treats that answer as the next episode, so we do too.
   *
   * `autoplayDisabled` is the series editor's switch: the card is still an
   * offer, but the player must not advance without a click.
   */
  async nextEpisode(request: NextEpisodeRequest): Promise<NextEpisode | null> {
    if (!request.isSeries || !request.collectionId) return null

    const r = await this.gql<{
      fetchSeries?: { next?: CmsCard | null; autoplayDisabled?: boolean | null }
    }>(Q.SERIES, {
      collection: request.collectionId,
      content: request.contentId,
      limit: 1
    }).catch(() => null)

    const candidate = r?.fetchSeries?.next
    if (!candidate) return null

    return {
      slug: candidate.slug,
      title: displayTitle(candidate),
      image: img(candidate.thumbnail?.sizes?.landscape?.url, 480),
      minutes: minutes(candidate.duration),
      autoplayDisabled: Boolean(r?.fetchSeries?.autoplayDisabled)
    }
  }

  /**
   * Queue one playback position. It leaves for Beacon within twenty seconds
   * (or sooner if ten are waiting), and a read that would show it flushes the
   * queue first.
   */
  async trackProgress(contentId: string, position: number, duration: number): Promise<boolean> {
    const session = await this.currentSession()
    if (!session || !contentId) return false
    const seconds = Math.round(position)
    const percent = duration ? Math.min(100, Math.round((seconds / duration) * 100)) : 0
    // A minute into a four-hour episode rounds to 0%, which reads as "never
    // started" to Continue watching; anything played counts as at least 1%.
    const shown = duration && seconds > 0 ? Math.max(1, percent) : percent
    const account = accountKey(session.email)
    // Playing is newer than an unsent mark for the same title; that mark and
    // its row removal must not follow this point to Beacon.
    this.progressQueue.dropMark(account, contentId)
    this.progressQueue.add(
      account,
      {
        content: contentId,
        duration: Math.round(duration || 0),
        videoProgress: shown,
        videoProgressSeconds: seconds
      },
      this.sessionId
    )
    // Playing the episode is a newer decision than the mark, whether or not the
    // report has landed. From here the server's own point takes over again.
    this.watchmarks.clear(session.email ?? null, contentId)
    this.startFlushTimer()
    // The app flushes as soon as ten are waiting rather than waiting for the
    // timer; the queue itself decides whether this update was a duplicate.
    if (this.progressQueue.size(account) >= BATCH_SIZE) {
      void this.flushProgress().catch(() => {})
    }
    return true
  }

  /**
   * Tell Beacon a view has started, before there is a position. The app forces
   * this one out immediately so a playback closed a second later still counts.
   */
  async trackStart(contentId: string): Promise<boolean> {
    const session = await this.currentSession()
    if (!session || !contentId) return false
    const account = accountKey(session.email)
    // A bare start is not a progress decision: it does not clear an explicit
    // mark or its pending write. The first real position report does that.
    this.progressQueue.add(account, { content: contentId }, this.sessionId)
    return this.flushProgress()
  }

  /** Send whatever progress is owed for the signed-in account. */
  async flushProgress(): Promise<boolean> {
    const session = await this.currentSession()
    if (!session) return false
    const account = accountKey(session.email)
    const before = this.progressQueue.size(account)
    if (!before) {
      this.stopFlushTimer()
      return true
    }
    // A batch already on the wire when this was called finishes first; an event
    // added during it would miss that drain, so go round again. Three rounds
    // covers a mark or a closing player racing the timer; the timer takes over
    // if anything is still left.
    let sent = true
    for (let round = 0; round < 3 && this.progressQueue.size(account); round++) {
      sent = await this.progressQueue
        .flush(account, (events) => this.sendEvents(events))
        .catch(() => false)
      if (!sent) break
    }
    // Only what actually left the queue has changed the rows and bars.
    if (this.progressQueue.size(account) < before) this.invalidateProgress()
    if (this.progressQueue.size(account)) this.startFlushTimer()
    else this.stopFlushTimer()
    return sent
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return
    const timer = setInterval(() => {
      void this.flushProgress().catch(() => {})
    }, FLUSH_EVERY)
    // The queue is best-effort; it must not hold a test or a quitting app open.
    timer.unref?.()
    this.flushTimer = timer
  }

  private stopFlushTimer(): void {
    if (!this.flushTimer) return
    clearInterval(this.flushTimer)
    this.flushTimer = undefined
  }

  /** Let queued progress writes land before reading what they change. */
  private async settleReports(): Promise<void> {
    // A write that never lands must not hold the screen shut either: past a few
    // seconds the read is better served stale than not at all.
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, REPORT_WAIT)
    })
    try {
      await Promise.race([this.flushProgress().catch(() => false), deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Mark one episode watched or unwatched.
   *
   * The mark is kept locally first: Beacon answers `trackView` with success but
   * quietly discards a near-end 98% report, so a server-only mark would visibly
   * bounce back. The mark then goes through the progress queue: any older
   * position still queued for this title is dropped, and the 97%/1% point is
   * sent after whatever is already in flight. An unwatched mark also removes
   * the title from Continue watching, but only for that direction: the
   * mutation zeroes the saved point, so it would undo a watched mark. The point
   * the member was looking at is recorded with the mark, so a watch on another
   * device makes it stale rather than being overwritten. Once Beacon's own read
   * agrees with the mark, the local copy is dropped.
   */
  async markWatched(slug: string, watched: boolean): Promise<WatchState> {
    const session = await this.currentSession()
    if (!session) {
      throw new BeaconError('Sign in with a Beacon account to track what you have watched.')
    }

    const known = this.catalog?.videoBySlug(slug) ?? null
    let id = known?.id ?? null
    let durationMs = known?.duration ?? null
    // The index may know the id but not the runtime; without it a watched mark
    // can only be placed at one second, which reads as unfinished elsewhere.
    if (!id || !durationMs) {
      const r = await this.gql<{
        Contents?: { docs?: { id: string; duration?: number | null }[] }
      }>(Q.LOOKUP, { slug }).catch(() => null)
      const doc = r?.Contents?.docs?.[0]
      id = id ?? doc?.id ?? null
      durationMs = durationMs ?? doc?.duration ?? null
    }
    if (!id) throw new BeaconError('Video not found.')

    // The point the member is looking at, kept with the mark so a later retry
    // can tell a write that was lost from a watch that happened elsewhere.
    // Read it directly: settling would send a queued position just to learn
    // what it is (the mark is about to drop it), and the cached read can be
    // older than the point the mark must be protected against.
    const current = await this.fetchProgress([id]).catch(() => null)
    const info = current?.[id]

    this.watchmarks.set(
      session.email ?? null,
      id,
      watched,
      info ? { progress: info.progress, position: info.position } : undefined
    )
    this.queueMark(accountKey(session.email), id, watched, durationMs)
    this.startFlushTimer()
    // Put it after any batch already in flight, but never hold the screen shut
    // on a stalled network; an unsent mark stays queued for the timer/launch.
    await this.settleReports()

    this.invalidateProgress()
    return { watched, progress: watched ? 1 : 0 }
  }

  /**
   * Put a mark's point on the wire. A mark is a newer decision than any
   * position still queued for this title: replaying an older one after the mark
   * would move Beacon back (it keeps the last point it is told) and put the
   * title in the row again.
   */
  private queueMark(
    account: string,
    id: string,
    watched: boolean,
    durationMs: number | null,
    retry = false
  ): void {
    const durationSec = Math.round((durationMs ?? 0) / 1000)
    // Both ends are a trap: a 0% and a near-end 98%+ report are accepted and
    // then discarded. Stay far enough inside each end to be stored, and close
    // enough to the end that the read still counts as finished.
    this.progressQueue.dropContent(account, id)
    this.progressQueue.add(
      account,
      {
        content: id,
        duration: durationSec,
        videoProgress: watched ? WATCHED_PERCENT : 1,
        videoProgressSeconds: watched ? Math.max(1, durationSec - 1) : 1,
        removeFromContinueWatching: !watched,
        explicitMark: true,
        retryOfMark: retry
      },
      this.sessionId
    )
  }

  /**
   * Ask Beacon for the marks it never took.
   *
   * `trackView` reports success even when it drops a point, so a mark can end
   * up living only on the machine that made it: the badge is right there and
   * wrong everywhere else. The local copy is what remembers the member's
   * choice, so the marks carried over from an earlier run are checked once, and
   * any Beacon's own read does not agree with is sent again. A mark that agrees
   * is dropped, exactly as a screen read would do it; a mark resolved while
   * this is reading is left to the queue it is already in.
   *
   * A mark is only sent again while the point it was made against is still
   * there. If the point moved, the mark is older than a watch somewhere else
   * and is dropped instead, so a retry cannot roll progress back.
   *
   * The retry budget counts sends that reached Beacon. A launch that was
   * offline or refused changes nothing, and a mark that has spent its budget
   * is still read and cleared when the server agrees or has moved on; only
   * the re-queue is skipped.
   */
  async reconcileMarks(ids?: string[]): Promise<void> {
    const session = await this.currentSession()
    const email = session?.email ?? null
    if (!session || !email) return
    const marks = this.watchmarks.marks(email)
    const marked = (ids ?? Object.keys(marks)).filter((id) => marks[id])
    if (!marked.length) return

    // A read that failed says nothing about the mark; leave it for next launch
    // rather than re-asserting a point over a network hiccup.
    const progress = await this.fetchProgress(marked).catch(() => null)
    if (!progress) return

    const account = accountKey(email)
    let queued = 0
    for (const id of marked) {
      const mark = marks[id]
      if (!mark) continue
      const info = progress[id]
      const durationMs = this.catalog?.videoById(id)?.duration ?? null
      const pct = info?.progress ?? 0
      const position = info?.position
      if (this.markAgrees(mark, durationMs, pct, position)) {
        this.watchmarks.clear(email, id)
        continue
      }
      // The point moved after the member's choice: a watch elsewhere is newer.
      if (this.markMovedSince(mark, pct, position)) {
        this.watchmarks.clear(email, id)
        continue
      }
      // No recorded point to compare against: only an episode that was never
      // started is safe to fill in; anything else may be a newer watch.
      if (!mark.base && !this.markWithoutBaseIsSafe(mark, pct)) {
        this.watchmarks.clear(email, id)
        continue
      }
      // The budget is spent, but the mark above was still compared with the
      // server's read, so a server that agrees or moved on can clear it.
      if ((mark.sends ?? 0) >= MARK_RETRIES) continue
      // Without a runtime the point cannot be placed; a rebuilt index will
      // carry it, and nothing here should guess at one second.
      if (!durationMs) continue
      this.queueMark(account, id, mark.watched, durationMs, true)
      queued += 1
    }
    if (!queued) return

    this.startFlushTimer()
    await this.settleReports()
    this.invalidateProgress()
  }

  // ---------- favourites ----------

  /** Every collection this member has favourited, in the order Beacon lists them. */
  async favouriteCollectionIds(): Promise<string[]> {
    const ids: string[] = []
    let page = 1
    let total = 1
    // totalPages is 0 when the member has none, so this still runs once.
    while (page <= total && page <= 20) {
      const r = await this.gql<{
        userCollectionFavourites?: { totalPages?: number; docs?: { id?: string }[] }
      }>(Q.FAVOURITE_COLLECTIONS, { limit: 100, page })
      const list = r.userCollectionFavourites
      total = list?.totalPages ?? 0
      for (const doc of list?.docs ?? []) if (doc.id) ids.push(doc.id)
      page++
    }
    return [...new Set(ids)]
  }

  async isCollectionFavourited(id: string): Promise<boolean> {
    const r = await this.gql<{ isCollectionFavourite?: boolean }>(Q.IS_COLLECTION_FAVOURITE, { id })
    return Boolean(r.isCollectionFavourite)
  }

  /**
   * Sets a favourite rather than toggling blind: the mutation flips whatever is
   * there, so a retry or a stale click would undo it. Reading first costs one
   * query and makes the write safe to repeat. Writes for the same id are
   * serialized, so two presses in quick succession cannot interleave.
   */
  async setCollectionFavourite(id: string, favourite: boolean): Promise<boolean> {
    const previous = this.favouriteWrites.get(id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => this.writeFavourite(id, favourite))
    this.favouriteWrites.set(id, run)
    try {
      return await run
    } finally {
      if (this.favouriteWrites.get(id) === run) this.favouriteWrites.delete(id)
    }
  }

  private async writeFavourite(id: string, favourite: boolean): Promise<boolean> {
    const current = await this.isCollectionFavourited(id)
    if (current === favourite) return current
    const r = await this.gql<{
      toggleCollectionFavourite?: {
        success?: boolean
        reason?: string
        isFavourite?: boolean | null
      }
    }>(Q.TOGGLE_COLLECTION_FAVOURITE, { id })
    const result = r.toggleCollectionFavourite
    if (!result?.success) {
      throw new BeaconError(result?.reason || 'Could not update favourites.')
    }
    return Boolean(result.isFavourite)
  }

  private async sendEvents(events: QueuedEvent[]): Promise<boolean> {
    // The queue's bookkeeping fields are ours; Beacon's EventInput has no
    // place for them.
    const payload = events.map((event) => ({
      content: event.content,
      viewedAt: event.viewedAt,
      sessionId: event.sessionId,
      duration: event.duration,
      videoProgress: event.videoProgress,
      videoProgressSeconds: event.videoProgressSeconds
    }))
    const r = await this.gql<{ trackView?: { success?: boolean } }>(Q.TRACK, { events: payload })
    if (!r?.trackView?.success) return false
    // An unwatched mark also leaves the row. Sending this only after the point
    // landed means a retry cannot remove before it writes. A later event for
    // the same title in this batch means playback resumed, so that newer point
    // decides and the removal is skipped. A failed removal must keep the event
    // queued: the 1% point alone still leaves the title in the row elsewhere.
    for (let index = 0; index < events.length; index++) {
      const event = events[index]!
      if (!event.removeFromContinueWatching) continue
      if (events.slice(index + 1).some((next) => next.content === event.content)) continue
      const removed = await this.gql<{
        removeContentFromContinueWatching?: { success?: boolean }
      }>(Q.REMOVE_FROM_CONTINUE_WATCHING, { id: event.content }).catch(() => null)
      if (!removed?.removeContentFromContinueWatching?.success) return false
    }
    // Count a mark retry only now that the whole event left the queue: a failed
    // or offline launch must not spend the mark's budget.
    const email = (await this.currentSession())?.email ?? null
    for (const event of events) {
      if (event.explicitMark && event.retryOfMark) this.watchmarks.retried(email, event.content)
    }
    return true
  }

  /** The rows, resume points and progress bars now describe an older moment. */
  private invalidateProgress(): void {
    // A feed read already in flight is now older than a local write; it may
    // still be shown to the caller, but it must not become the next launch's
    // cache. Cross-client writes cannot be seen at all, which is why every
    // launch revalidates regardless of this counter.
    this.feedGeneration += 1
    this.homeCache.clear()
    this.collectionCache.clear()
    this.contentCache.clear()
    this.playbackCache.clear()
    this.progressCache.clear()
  }

  async search(query: string): Promise<SearchData> {
    const key = `${await this.scope()}|${query.trim().toLowerCase()}`
    const data = await this.searchCache.load(key, () => this.buildSearch(query))
    // A failed remote query leaves only the local index; do not remember that
    // as the whole answer.
    if (!data.series.length && !data.videos.length) this.searchCache.delete(key)
    return data
  }

  private async buildSearch(query: string): Promise<SearchData> {
    await this.catalog?.ensure().catch(() => {})
    const level = await this.userLevel()
    const local = this.catalog?.localSearch(query) ?? { collections: [], videos: [] }

    const remote = await this.gql<{ search?: { docs?: CmsCard[] } }>(Q.SEARCH, {
      q: query,
      types: Q.PLAYABLE,
      page: 1,
      limit: 20
    }).catch(() => null)

    const videos: Card[] = local.videos.map((v) => indexedVideoCard(v, level))
    for (const d of remote?.search?.docs ?? []) {
      if (!videos.some((v) => v.slug === d.slug)) videos.push(videoCard(d, level))
    }

    return {
      series: local.collections.map((c) => ({
        kind: 'series' as const,
        id: c.id,
        slug: c.slug,
        title: c.name,
        image: img(c.image ?? c.portrait, 480),
        image2x: img(c.image2x, 480),
        count: c.itemCount
      })),
      videos: videos.slice(0, 48)
    }
  }

  suggest(query: string): string[] {
    return this.catalog?.suggest(query) ?? []
  }
}
