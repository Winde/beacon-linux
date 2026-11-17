import { net } from 'electron'
import type {
  AuthStatus,
  Card,
  CaptionTrack,
  CollectionData,
  ContentData,
  HomeData,
  HomeRow,
  NextEpisode,
  NextEpisodeRequest,
  PlaybackData,
  Row,
  SearchData,
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

const CMS_URL = 'https://critrole-beacon-production-backend.clockhosting.com/api/graphql'
const OAUTH_URL = 'https://pocketbeacon.memberful.com/oauth/token'
/** beacon.tv's own public Memberful client. */
const CLIENT_ID = '3Wdgxb5im239JhTBhS7KczZn'

const LEVEL_TTL = 10 * 60 * 1000
/** How long a screen may wait for progress writes before reading anyway. */
const REPORT_WAIT = 5_000
/** The app's own client flushes progress on this interval. */
const FLUSH_EVERY = 20_000

/** Must match the `x-platform` header sent with every request. */
const PLATFORM = 'web'
/** The content types this client can open today. */
const VIDEO_TYPES = new Set(['video', 'videoPodcast'])

export class BeaconError extends Error {
  status?: number
  rejected?: boolean
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
  localSearch(q: string, limit?: number): { collections: IndexedCollection[]; videos: IndexedVideo[] }
  suggest(q: string, limit?: number): string[]
}

interface CmsThumb {
  sizes?: {
    landscape?: { url?: string } | null
    landscape2x?: { url?: string } | null
    portrait?: { url?: string } | null
  } | null
}

interface CmsCard {
  id: string
  title: string
  /** The editor's short, display-oriented title; falls back to `title`. */
  ottTitle?: string | null
  duration?: number | null
  slug: string
  contentType?: string | null
  episodeNumber?: number | null
  releaseDate?: string | null
  contentTier?: { name?: string; planLevel?: number } | null
  primaryCollection?: { id: string; name: string; slug: string; isSeries: boolean } | null
  thumbnail?: CmsThumb | null
}

/** What Beacon remembers about one video: how far, and where exactly. */
interface ProgressInfo {
  /** 0..1 */
  progress: number
  position: number | null
}

interface CmsCollection {
  id: string
  name: string
  slug: string
  isSeries?: boolean
  itemCount?: number | null
  releaseDate?: string | null
  thumbnail?: CmsThumb | null
}

/** A home block as it arrives from Beacon; only some types carry fields. */
interface PlatformExclusions {
  ios?: boolean
  android?: boolean
  web?: boolean
}

interface BlockContent {
  __typename?: string
  id: string
  title?: string
  ottTitle?: string | null
  slug: string
  duration?: number | null
  contentType?: string | null
  episodeNumber?: number | null
  releaseDate?: string | null
  contentTier?: { name?: string; planLevel?: number } | null
  primaryCollection?: { id: string; name: string; slug: string; isSeries?: boolean } | null
  thumbnail?: CmsThumb | null
}

interface BlockCollection {
  __typename?: string
  id: string
  name: string
  slug: string
  itemCount?: number | null
  thumbnail?: CmsThumb | null
}

interface HomeBlock {
  __typename?: string
  id?: string
  title?: string
  limit?: number | null
  content?: (BlockContent | BlockCollection)[]
  items?: { item?: { value?: BlockContent | BlockCollection } }[]
  excludedPlatforms?: PlatformExclusions | null
}

interface ContinueWatchingDoc {
  videoProgress?: number
  videoProgressSeconds?: number
  content?: CmsCard
}

interface ContinueWatchingResult {
  continueWatching?: { docs?: ContinueWatchingDoc[] }
}

const minutes = (ms?: number | null): number | null =>
  ms ? Math.max(1, Math.round(ms / 60000)) : null

function captionsOf(video: { videoData?: string; closedCaptions?: string }): CaptionTrack[] {
  const out: CaptionTrack[] = []
  try {
    const data = JSON.parse(video.videoData || '{}') as {
      playlist?: { tracks?: { kind?: string; label?: string; file?: string }[] }[]
    }
    for (const track of data.playlist?.[0]?.tracks ?? []) {
      if ((track.kind === 'captions' || track.kind === 'subtitles') && track.file) {
        out.push({ label: track.label || 'Subtitles', url: track.file })
      }
    }
  } catch {
    // no playlist data
  }
  if (!out.length && typeof video.closedCaptions === 'string' && /^https?:/.test(video.closedCaptions)) {
    out.push({ label: 'Subtitles', url: video.closedCaptions })
  }
  return out
}

/**
 * A title leaves "Continue watching" once it is past this share of its runtime
 * and only this little remains. The share alone misjudges long episodes: 92%
 * of a four-hour episode still has nineteen minutes left to play.
 */
const FINISHED_SHARE = 92
const FINISHED_TAIL = 5 * 60 // seconds

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
 * Whether a video is in its closing stretch: past `share` percent and, when
 * the runtime is known, with no more than `tail` seconds left.
 */
function closingStretch(
  progress: number,
  position: number | null | undefined,
  runtimeSec: number | null | undefined,
  share: number,
  tail: number
): boolean {
  if (progress < share) return false
  // Without a runtime there is no tail to measure; keep the plain share rule.
  if (!runtimeSec) return true
  const left =
    position != null && position >= 0 && position <= runtimeSec
      ? runtimeSec - position
      : (runtimeSec * (100 - progress)) / 100
  return left <= tail
}

export class BeaconClient {
  // Loaded once, on first use and after the app is ready: safeStorage needs that,
  // and this class is constructed at module load, before it.
  private sessionState: Session | null | undefined = undefined
  private sessionLoad: Promise<Session | null> | null = null
  private refreshing: Promise<string | null> | null = null
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
  /** Five minutes: series cards show progress, so shorter is more accurate. */
  private readonly collectionCache = new TtlCache<string, CollectionData>(5 * 60_000, 40)
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
  private readonly progressQueue = new ProgressQueue(
    undefined,
    () => {
      try {
        return typeof net.isOnline === 'function' ? net.isOnline() : true
      } catch {
        return true
      }
    }
  )
  private flushTimer: ReturnType<typeof setInterval> | undefined

  /** What an entry belongs to: a member's rows and tier are not shared. */
  private async scope(): Promise<string> {
    const session = await this.currentSession()
    return session?.email ?? 'guest'
  }

  private clearCaches(): void {
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
        // send starts the timer as usual.
        if (session && this.progressQueue.size(accountKey(session.email))) {
          void this.flushProgress().catch(() => {})
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
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString()
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

  async status(): Promise<AuthStatus> {
    const session = await this.currentSession()
    if (!session) return { signedIn: false, user: null }
    try {
      const r = await this.gql<{
        meMember?: {
          user?: {
            username?: string
            activeSubscription?: boolean
            tier?: { name?: string; planLevel?: number } | null
          }
        }
      }>(Q.ME)
      const user = r.meMember?.user
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
        body: JSON.stringify({ query, variables })
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
    const r = await this.gql<{
      meMember?: { user?: { tier?: { planLevel?: number } | null } }
    }>(Q.ME).catch(() => null)
    const value = r?.meMember?.user?.tier?.planLevel ?? 1
    this.level = { at: Date.now(), value }
    return value
  }

  // ---------- cards ----------

  private videoCard(c: CmsCard, level: number, state?: WatchState): Card {
    return {
      kind: 'video',
      id: c.id,
      slug: c.slug,
      title: displayTitle(c),
      subtitle: c.primaryCollection?.name ?? '',
      image: img(c.thumbnail?.sizes?.landscape?.url, 480),
      image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
      minutes: minutes(c.duration),
      locked: (c.contentTier?.planLevel ?? 0) > level,
      progress: state?.progress ?? 0,
      watched: state?.watched ?? false
    }
  }

  private indexedVideoCard(v: IndexedVideo, level: number, state?: WatchState): Card {
    return {
      kind: 'video',
      id: v.id,
      slug: v.slug,
      title: displayTitle(v),
      subtitle: v.series?.name ?? '',
      image: img(v.image, 480),
      image2x: img(v.image2x, 480),
      minutes: minutes(v.duration),
      locked: v.level > level,
      progress: state?.progress ?? 0,
      watched: state?.watched ?? false
    }
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
   * reporting the old point. Once Beacon's read agrees with the mark, the mark
   * is dropped so a later watch on another device is not masked.
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
    const atStart =
      progress <= 0.01 || (position != null && position > 0 && position <= RESUME_MIN)
    if (mark.watched ? watched : atStart) {
      this.watchmarks.clear(email, id)
      return { progress, watched }
    }
    return { watched: mark.watched, progress: mark.watched ? 1 : 0 }
  }

  private seriesCard(c: CmsCollection): Card {
    return {
      kind: 'series',
      id: c.id,
      slug: c.slug,
      title: c.name,
      image: img(c.thumbnail?.sizes?.landscape?.url ?? c.thumbnail?.sizes?.portrait?.url, 480),
      image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
      count: c.itemCount ?? null
    }
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
    const map: Record<string, ProgressInfo> = {}
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.gql<{
        getProgressForContent?: {
          timeMap?: { contentId: string; videoProgress?: number; videoProgressSeconds?: number }[]
        }
      }>(Q.PROGRESS_FOR, { ids: ids.slice(i, i + 100) }).catch(() => null)
      for (const p of r?.getProgressForContent?.timeMap ?? []) {
        map[p.contentId] = {
          progress: Math.min(1, (p.videoProgress ?? 0) / 100),
          position: p.videoProgressSeconds ?? null
        }
      }
    }
    return map
  }

  // ---------- screens ----------

  async home(): Promise<HomeData> {
    await this.settleReports()
    const key = await this.scope()
    const data = await this.homeCache.load(key, () => this.buildHome())
    // A CMS hiccup must not be remembered as an empty home for a minute.
    if (!data.hero.length && !data.rows.length) this.homeCache.delete(key)
    return data
  }

  private async buildHome(): Promise<HomeData> {
    const signed = await this.isSignedIn()
    const level = await this.userLevel()
    this.catalog?.ensure().catch(() => {})

    const [page, cw] = await Promise.all([
      this.gql<{ MemberHomePage?: { pageContent?: HomeBlock[] } }>(Q.HOME_BLOCKS),
      signed
        ? this.gql<ContinueWatchingResult>(Q.CONTINUE_WATCHING, { limit: 50 }).catch(() => null)
        : Promise.resolve(null)
    ])

    const rows: HomeRow[] = []
    let hero: Card[] = []

    for (const block of page.MemberHomePage?.pageContent ?? []) {
      if (!this.blockVisible(block)) continue

      switch (block.__typename) {
        case 'RedesignHeroCarousel':
          hero = (block.items ?? [])
            .map((entry) => entry.item?.value)
            .filter((value): value is BlockContent | BlockCollection => Boolean(value))
            .map((value) => this.blockCard(value, level))
            .filter((card): card is Card => card !== null)
            .map((card) => this.heroSized(card))
            .slice(0, 8)
          break

        case 'ContinueWatchingV2': {
          if (!cw) break
          const limit = Math.max(1, Math.min(50, block.limit ?? 20))
          const row = await this.continueWatchingRow(cw, level, limit, block.id)
          if (row) rows.push(row)
          break
        }

        case 'FeaturedCarousel':
        case 'LatestCarousel': {
          const kind = block.__typename === 'FeaturedCarousel' ? 'featured' : 'latest'
          const items = this.blockCards(block.content, level)
          if (items.length) {
            rows.push({
              id: block.id ?? kind,
              kind,
              title: block.title || (kind === 'featured' ? 'Featured' : 'Latest'),
              items
            })
          }
          break
        }

        case 'SeriesCarousel': {
          const items = (block.content ?? [])
            .filter((value): value is BlockCollection => 'name' in value)
            .map((value) => this.seriesCard(value))
          if (items.length) {
            rows.push({
              id: block.id ?? 'series',
              kind: 'series',
              title: block.title || 'Series',
              items
            })
          }
          break
        }
      }
    }

    // A hero block can be missing or hold only kinds we cannot open; the first
    // video shelf is a serviceable stand-in.
    if (!hero.length) {
      const source =
        rows.find((row) => row.kind === 'featured') ?? rows.find((row) => row.kind === 'latest')
      hero = (source?.items ?? [])
        .filter((card) => card.kind === 'video')
        .slice(0, 5)
        .map((card) => this.heroSized(card))
    }

    return { hero, rows: rows.filter((row) => row.items.length) }
  }

  /** Blocks excluded for the platform we identify as are not rendered at all. */
  private blockVisible(block: HomeBlock): boolean {
    return !block.excludedPlatforms?.[PLATFORM]
  }

  private blockCards(
    values: (BlockContent | BlockCollection)[] | undefined,
    level: number
  ): Card[] {
    return (values ?? [])
      .map((value) => this.blockCard(value, level))
      .filter((card): card is Card => card !== null)
  }

  /** A block item, or null when it is a kind this TV client cannot open. */
  private blockCard(value: BlockContent | BlockCollection, level: number): Card | null {
    if ('name' in value) return this.seriesCard(value)
    return VIDEO_TYPES.has(value.contentType ?? '')
      ? this.videoCard(value as CmsCard, level)
      : null
  }

  /** The hero asks for its own image size; a tile's is too soft full-bleed. */
  private heroSized(card: Card): Card {
    return {
      ...card,
      image: img(card.image, 1280),
      image2x: img(card.image2x, 1280)
    }
  }

  private async continueWatchingRow(
    cw: ContinueWatchingResult,
    level: number,
    limit: number,
    blockId?: string
  ): Promise<HomeRow | null> {
    const watching = (cw.continueWatching?.docs ?? [])
      .filter((doc) => doc.content)
      .slice(0, limit)
    if (!watching.length) return null

    const { email, marks } = await this.watchMarks()
    const states = new Map(
      watching.map((doc) => {
        const content = doc.content!
        return [
          content.id,
          this.effectiveWatch(
            content.id,
            content.duration,
            Math.min(1, (doc.videoProgress ?? 0) / 100),
            doc.videoProgressSeconds,
            email,
            marks
          )
        ] as const
      })
    )
    // A cleared episode sits at one second, which Beacon may still list as
    // started. Neither a mark nor that residue belongs in this row.
    const unfinished = watching.filter((doc) => {
      const state = states.get(doc.content!.id)!
      return !state.watched && state.progress > 0.01
    })
    if (!unfinished.length) return null

    return {
      id: blockId ?? 'continue',
      kind: 'continue',
      title: 'Continue watching',
      items: unfinished.map((doc) =>
        this.videoCard(doc.content!, level, states.get(doc.content!.id))
      )
    }
  }

  async collection(slug: string): Promise<CollectionData> {
    await this.settleReports()
    const key = `${await this.scope()}|${slug}`
    return this.collectionCache.load(key, () => this.buildCollection(slug))
  }

  private async buildCollection(slug: string): Promise<CollectionData> {
    await this.catalog?.ensure().catch(() => {})
    let known = this.catalog?.collectionBySlug(slug) ?? null
    // A home block can feature a collection newer than the catalog snapshot.
    if (!known) {
      await this.catalog?.refresh().catch(() => {})
      known = this.catalog?.collectionBySlug(slug) ?? null
    }
    if (!known) throw new Error('Series not found.')
    const level = await this.userLevel()
    const { email, marks } = await this.watchMarks()

    const toCards = async (docs: CmsCard[]): Promise<Card[]> => {
      const progress = await this.progressFor(docs.map((d) => d.id))
      return docs.map((d) => {
        const info = progress[d.id]
        return this.videoCard(
          d,
          level,
          this.effectiveWatch(
            d.id,
            d.duration,
            info?.progress ?? 0,
            info?.position,
            email,
            marks
          )
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

  async content(slug: string): Promise<ContentData> {
    await this.settleReports()
    const key = `${await this.scope()}|${slug}`
    return this.contentCache.load(key, () => this.buildContent(slug))
  }

  private async buildContent(slug: string): Promise<ContentData> {
    const r = await this.gql<{
      Contents?: {
        docs?: (CmsCard & {
          description?: string
          content?: { carouselContent?: CmsCard[] }[]
          contentVideo?: {
            video?: {
              video?: string
              videoData?: string
              closedCaptions?: string
            } | null
          } | null
        })[]
      }
      currentProgress?: { videoProgress?: number; videoProgressSeconds?: number } | null
    }>(Q.CONTENT, { slug })

    const doc = r.Contents?.docs?.[0]
    if (!doc) throw new Error('Video not found.')

    this.catalog?.ensure().catch(() => {})
    const level = await this.userLevel()
    const signedIn = await this.isSignedIn()
    const { email, marks } = await this.watchMarks()
    const video = doc.contentVideo?.video
    const series = doc.primaryCollection ?? null
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
        rows.push({ title: 'Next episode', items: [this.videoCard(nextDoc, level)] })
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
        rows.push({ title: 'Other versions', items: versions.map((v) => this.indexedVideoCard(v, level)) })
      }
    }

    if (series && this.catalog) {
      const list = this.catalog.seriesVideos(series.id)
      const index = list.findIndex((v) => v.slug === slug)
      let around = index >= 0 ? list.slice(index + 1, index + 13) : []
      if (!around.length) around = list.filter((v) => v.slug !== slug).slice(-12).reverse()
      if (around.length) {
        for (const v of around) meta.set(v.slug, { id: v.id, duration: v.duration })
        rows.push({
          title: `More from ${series.name}`,
          items: around.map((v) => this.indexedVideoCard(v, level))
        })
      }
    }

    const suggested = (doc.content ?? [])
      .flatMap((b) => b?.carouselContent ?? [])
      .filter((c): c is CmsCard => Boolean(c))
    if (suggested.length) {
      for (const c of suggested) addMeta(c)
      rows.push({ title: 'Recommended', items: suggested.map((c) => this.videoCard(c, level)) })
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
    // server still reports; start it from the beginning either way.
    const marked = Boolean(marks[doc.id])
    const docWatched = this.effectiveWatch(
      doc.id,
      doc.duration,
      docProgress,
      docPosition,
      email,
      marks
    ).watched
    const resumeFrom = docPosition ?? 0
    const resumeAt =
      !marked &&
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
    if (video?.video) {
      this.playbackCache.set(`${await this.scope()}|${slug}`, {
        id: doc.id,
        title: doc.title,
        url: video.video,
        playlist: null,
        duration: doc.duration ? Math.round(doc.duration / 1000) : null,
        resumeAt,
        captions: captionsOf(video),
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
      image: img(doc.thumbnail?.sizes?.landscape?.url, 1280),
      image2x: img(doc.thumbnail?.sizes?.landscape2x?.url, 1280),
      minutes: minutes(doc.duration),
      released: doc.releaseDate ?? null,
      series: series ? { slug: series.slug, title: series.name } : null,
      tier: doc.contentTier?.name ?? null,
      locked: !video?.video,
      signInNeeded: !video?.video && !signedIn,
      signedIn,
      watched: docWatched,
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
          contentVideo?: {
            video?: { video?: string; videoData?: string; closedCaptions?: string } | null
          } | null
        }[]
      }
      currentProgress?: { videoProgress?: number; videoProgressSeconds?: number } | null
    }>(Q.MEDIA, { slug })

    const doc = r.Contents?.docs?.[0]
    const video = doc?.contentVideo?.video
    if (!video?.video) return null

    const cp = r.currentProgress
    const runtimeSec = (doc?.duration ?? 0) / 1000
    const resumeFrom = cp?.videoProgressSeconds ?? 0
    const { marks } = await this.watchMarks()
    const marked = Boolean(doc?.id && marks[doc.id])
    return {
      id: doc?.id ?? '',
      title: doc?.title ?? '',
      url: video.video,
      playlist: null,
      duration: doc?.duration ? Math.round(doc.duration / 1000) : null,
      resumeAt:
        !marked &&
        cp &&
        resumeFrom > RESUME_MIN &&
        !closingStretch(
          cp.videoProgress ?? 0,
          cp.videoProgressSeconds,
          runtimeSec,
          RESUME_SHARE,
          RESUME_TAIL
        )
          ? resumeFrom
          : 0,
      captions: captionsOf(video),
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
   * keeps reporting the old point for both extremes, so a server-only mark
   * would visibly bounce back. The mark then goes through the progress queue:
   * any older position still queued for this title is dropped, the 99%/1% point
   * is sent after whatever is already in flight, and the Continue-watching
   * removal follows the point that landed. Once Beacon's own read agrees with
   * the mark, the local copy is dropped.
   */
  async markWatched(slug: string, watched: boolean): Promise<WatchState> {
    const session = await this.currentSession()
    if (!session) {
      throw new BeaconError('Sign in with a Beacon account to track what you have watched.')
    }

    const known = this.catalog?.videoBySlug(slug) ?? null
    let id = known?.id ?? null
    let durationMs = known?.duration ?? null
    if (!id) {
      const r = await this.gql<{
        Contents?: { docs?: { id: string; duration?: number | null }[] }
      }>(Q.LOOKUP, { slug })
      const doc = r.Contents?.docs?.[0]
      id = doc?.id ?? null
      durationMs = doc?.duration ?? null
    }
    if (!id) throw new BeaconError('Video not found.')

    this.watchmarks.set(session.email ?? null, id, watched)

    const durationSec = Math.round((durationMs ?? 0) / 1000)
    // Both 0 and 100 come back unchanged from the CMS, so stay one step inside
    // each end. The results still read as finished or at the start.
    const seconds = watched ? Math.max(1, durationSec - 1) : 1
    const account = accountKey(session.email)
    // A mark is a newer decision than any position still queued for this title.
    // Replaying an older one after the mark would move Beacon back (it keeps
    // the last point it is told) and put the title in the row again.
    this.progressQueue.dropContent(account, id)
    this.progressQueue.add(
      account,
      {
        content: id,
        duration: durationSec,
        videoProgress: watched ? 99 : 1,
        videoProgressSeconds: seconds,
        removeFromContinueWatching: true
      },
      this.sessionId
    )
    this.startFlushTimer()
    // Put it after any batch already in flight, but never hold the screen shut
    // on a stalled network; an unsent mark stays queued for the timer/launch.
    await this.settleReports()

    this.invalidateProgress()
    return { watched, progress: watched ? 1 : 0 }
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
      toggleCollectionFavourite?: { success?: boolean; reason?: string; isFavourite?: boolean | null }
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
    // A mark is not finished until its title leaves the row. Sending this only
    // after the point landed means a retry cannot remove before it writes. A
    // later event for the same title in this batch means playback resumed, so
    // that newer point decides and the removal is skipped.
    for (let index = 0; index < events.length; index++) {
      const event = events[index]!
      if (!event.removeFromContinueWatching) continue
      if (events.slice(index + 1).some((next) => next.content === event.content)) continue
      await this.gql(Q.REMOVE_FROM_CONTINUE_WATCHING, { id: event.content }).catch(() => null)
    }
    return true
  }

  /** The rows, resume points and progress bars now describe an older moment. */
  private invalidateProgress(): void {
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

    const videos: Card[] = local.videos.map((v) => this.indexedVideoCard(v, level))
    for (const d of remote?.search?.docs ?? []) {
      if (!videos.some((v) => v.slug === d.slug)) videos.push(this.videoCard(d, level))
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
