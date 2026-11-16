import { net } from 'electron'
import type {
  AuthStatus,
  Card,
  CaptionTrack,
  CollectionData,
  ContentData,
  HomeData,
  PlaybackData,
  Row,
  SearchData
} from '@shared/types'
import { loadSession, saveSession, type Session } from './session'
import * as Q from './queries'
import { episodeCode, imageUrl as img } from './text'
import type { IndexedCollection, IndexedVideo } from './catalog-types'

const CMS_URL = 'https://critrole-beacon-production-backend.clockhosting.com/api/graphql'
const OAUTH_URL = 'https://pocketbeacon.memberful.com/oauth/token'
/** beacon.tv's own public Memberful client. */
const CLIENT_ID = '3Wdgxb5im239JhTBhS7KczZn'

const LEVEL_TTL = 10 * 60 * 1000

export class BeaconError extends Error {
  status?: number
  rejected?: boolean
}

/** The parts of the catalog index this client needs. */
export interface CatalogLike {
  ensure(): Promise<void>
  videoBySlug(slug: string): IndexedVideo | null
  collectionBySlug(slug: string): IndexedCollection | null
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
  duration?: number | null
  slug: string
  contentType?: string | null
  episodeNumber?: number | null
  releaseDate?: string | null
  contentTier?: { name?: string; planLevel?: number } | null
  primaryCollection?: { id: string; name: string; slug: string; isSeries: boolean } | null
  thumbnail?: CmsThumb | null
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

export class BeaconClient {
  // Loaded once, on first use and after the app is ready: safeStorage needs that,
  // and this class is constructed at module load, before it.
  private sessionState: Session | null | undefined = undefined
  private sessionLoad: Promise<Session | null> | null = null
  private refreshing: Promise<string | null> | null = null
  private level: { at: number; value: number } | null = null
  private sessionId = 'linux-' + Math.random().toString(36).slice(2, 10)

  private async currentSession(): Promise<Session | null> {
    if (this.sessionState !== undefined) return this.sessionState
    if (!this.sessionLoad) {
      this.sessionLoad = loadSession().then((session) => {
        this.sessionState = session
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

  // ---------- auth ----------

  private async tokenRequest(params: Record<string, string>): Promise<{
    access_token: string
    refresh_token?: string
    expires_in?: number
  }> {
    const qs = new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString()
    const res = await net.fetch(`${OAUTH_URL}?${qs}`, { method: 'POST' })
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
    return this.status()
  }

  async signOut(): Promise<void> {
    await this.updateSession(null)
    this.level = null
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
      return {
        signedIn: true,
        user: {
          name: user?.username || session.email || 'Member',
          tier: user?.tier?.name ?? null,
          active: Boolean(user?.activeSubscription)
        }
      }
    } catch (err) {
      if ((err as BeaconError).status === 401) {
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
          'x-platform': 'web',
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

  private videoCard(c: CmsCard, level: number, progress = 0): Card {
    return {
      kind: 'video',
      slug: c.slug,
      title: c.title,
      subtitle: c.primaryCollection?.name ?? '',
      image: img(c.thumbnail?.sizes?.landscape?.url, 480),
      image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
      minutes: minutes(c.duration),
      locked: (c.contentTier?.planLevel ?? 0) > level,
      progress
    }
  }

  private indexedVideoCard(v: IndexedVideo, level: number, progress = 0): Card {
    return {
      kind: 'video',
      slug: v.slug,
      title: v.title,
      subtitle: v.series?.name ?? '',
      image: img(v.image, 480),
      image2x: img(v.image2x, 480),
      minutes: minutes(v.duration),
      locked: v.level > level,
      progress
    }
  }

  private seriesCard(c: CmsCollection): Card {
    return {
      kind: 'series',
      slug: c.slug,
      title: c.name,
      image: img(c.thumbnail?.sizes?.landscape?.url ?? c.thumbnail?.sizes?.portrait?.url, 480),
      image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
      count: c.itemCount ?? null
    }
  }

  async progressFor(ids: string[]): Promise<Record<string, number>> {
    const map: Record<string, number> = {}
    if (!(await this.currentSession()) || !ids.length) return map
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.gql<{
        getProgressForContent?: {
          timeMap?: { contentId: string; videoProgress?: number }[]
        }
      }>(Q.PROGRESS_FOR, { ids: ids.slice(i, i + 100) }).catch(() => null)
      for (const p of r?.getProgressForContent?.timeMap ?? []) {
        map[p.contentId] = Math.min(1, (p.videoProgress ?? 0) / 100)
      }
    }
    return map
  }

  // ---------- screens ----------

  async home(): Promise<HomeData> {
    const signed = await this.isSignedIn()
    const level = await this.userLevel()
    this.catalog?.ensure().catch(() => {})

    const [cw, recent, collections] = await Promise.all([
      signed
        ? this.gql<{
            continueWatching?: {
              docs?: { videoProgress?: number; content?: CmsCard }[]
            }
          }>(Q.CONTINUE_WATCHING, { limit: 30 }).catch(() => null)
        : Promise.resolve(null),
      this.gql<{ search?: { docs?: CmsCard[] } }>(Q.SEARCH, {
        types: Q.PLAYABLE,
        sort: '-releaseDate',
        page: 1,
        limit: 24
      }).catch(() => null),
      this.gql<{ collectionSearch?: { docs?: CmsCollection[] } }>(Q.COLLECTIONS, {
        page: 1,
        limit: 30
      }).catch(() => null)
    ])

    const rows: Row[] = []

    const watching = (cw?.continueWatching?.docs ?? []).filter((d) => d.content)
    if (watching.length) {
      const progress: Record<string, number> = {}
      for (const d of watching) {
        if (d.content) progress[d.content.id] = Math.min(1, (d.videoProgress ?? 0) / 100)
      }
      const unfinished = watching.filter((d) => (d.videoProgress ?? 0) < 92)
      if (unfinished.length) {
        rows.push({
          title: 'Continue watching',
          items: unfinished.map((d) => this.videoCard(d.content!, level, progress[d.content!.id]))
        })
      }
    }

    const recentDocs = recent?.search?.docs ?? []
    if (recentDocs.length) {
      rows.push({
        title: 'Recently added',
        items: recentDocs.map((c) => this.videoCard(c, level))
      })
    }

    const allCollections = collections?.collectionSearch?.docs ?? []
    const series = allCollections.filter((c) => c.isSeries)
    const other = allCollections.filter((c) => !c.isSeries && (c.itemCount ?? 0) > 0)
    if (series.length) rows.push({ title: 'Series', items: series.map((c) => this.seriesCard(c)) })
    if (other.length) rows.push({ title: 'Collections', items: other.map((c) => this.seriesCard(c)) })

    const heroSource = recentDocs.filter((c) => (c.duration ?? 0) >= 20 * 60 * 1000)
    const hero = (heroSource.length ? heroSource : recentDocs).slice(0, 5).map((c) => ({
      ...this.videoCard(c, level),
      image: img(c.thumbnail?.sizes?.landscape?.url, 1280),
      image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 1280)
    }))

    return { hero, rows: rows.filter((r) => r.items.length) }
  }

  async collection(slug: string): Promise<CollectionData> {
    await this.catalog?.ensure().catch(() => {})
    const known = this.catalog?.collectionBySlug(slug) ?? null
    if (!known) throw new Error('Series not found.')
    const level = await this.userLevel()

    const toCards = async (docs: CmsCard[]): Promise<Card[]> => {
      const progress = await this.progressFor(docs.map((d) => d.id))
      return docs.map((d) => this.videoCard(d, level, progress[d.id] ?? 0))
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
      slug,
      title: known.name,
      image: img(known.image ?? known.portrait, 1280),
      image2x: img(known.image2x, 1280),
      isSeries: false,
      seasons: [{ title: 'Videos', items: await toCards(docs) }]
    }
  }

  async content(slug: string): Promise<ContentData> {
    const r = await this.gql<{
      Contents?: {
        docs?: (CmsCard & {
          description?: string
          content?: { carouselContent?: CmsCard[] }[]
          contentVideo?: { video?: { video?: string } | null } | null
        })[]
      }
      currentProgress?: { videoProgress?: number; videoProgressSeconds?: number } | null
    }>(Q.CONTENT, { slug })

    const doc = r.Contents?.docs?.[0]
    if (!doc) throw new Error('Video not found.')

    this.catalog?.ensure().catch(() => {})
    const level = await this.userLevel()
    const video = doc.contentVideo?.video
    const series = doc.primaryCollection ?? null
    const rows: Row[] = []

    if (series?.isSeries) {
      const next = await this.gql<{ fetchSeries?: { next?: CmsCard | null } }>(Q.SERIES, {
        collection: series.id,
        content: doc.id,
        limit: 1
      }).catch(() => null)
      const nextDoc = next?.fetchSeries?.next
      if (nextDoc) rows.push({ title: 'Next episode', items: [this.videoCard(nextDoc, level)] })
    }

    const known = this.catalog?.videoBySlug(slug) ?? null
    const code = known ? episodeCode(known.title) : null
    if (code && this.catalog) {
      const versions = this.catalog
        .seriesVideos(known?.series?.id ?? '')
        .filter((v) => v.id !== known?.id && episodeCode(v.title) === code)
      if (versions.length) {
        rows.push({ title: 'Other versions', items: versions.map((v) => this.indexedVideoCard(v, level)) })
      }
    }

    if (series && this.catalog) {
      const list = this.catalog.seriesVideos(series.id)
      const index = list.findIndex((v) => v.slug === slug)
      let around = index >= 0 ? list.slice(index + 1, index + 13) : []
      if (!around.length) around = list.filter((v) => v.slug !== slug).slice(-12).reverse()
      if (around.length) {
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
      rows.push({ title: 'Recommended', items: suggested.map((c) => this.videoCard(c, level)) })
    }

    const idOf = (slug: string): string | null => this.catalog?.videoBySlug(slug)?.id ?? null
    const progress = await this.progressFor(
      [...new Set(rows.flatMap((row) => row.items.map((i) => idOf(i.slug))))].filter(
        (id): id is string => Boolean(id)
      )
    )
    for (const row of rows) {
      for (const item of row.items) {
        const id = idOf(item.slug)
        if (id) item.progress = progress[id] ?? 0
      }
    }

    const cp = r.currentProgress
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
      signInNeeded: !video?.video && !(await this.isSignedIn()),
      resumeAt: cp && (cp.videoProgress ?? 0) < 95 ? (cp.videoProgressSeconds ?? 0) : 0,
      rows
    }
  }

  async play(slug: string): Promise<PlaybackData | null> {
    const r = await this.gql<{
      Contents?: {
        docs?: {
          id: string
          title: string
          duration?: number | null
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
    return {
      id: doc?.id ?? '',
      title: doc?.title ?? '',
      url: video.video,
      playlist: null,
      duration: doc?.duration ? Math.round(doc.duration / 1000) : null,
      resumeAt: cp && (cp.videoProgress ?? 0) < 95 ? (cp.videoProgressSeconds ?? 0) : 0,
      captions: captionsOf(video)
    }
  }

  async trackProgress(contentId: string, position: number, duration: number): Promise<boolean> {
    if (!(await this.currentSession()) || !contentId) return false
    const event = {
      content: contentId,
      viewedAt: new Date().toISOString(),
      sessionId: this.sessionId,
      duration: Math.round(duration || 0),
      videoProgressSeconds: Math.round(position),
      videoProgress: duration ? Math.min(100, Math.round((position / duration) * 100)) : 0
    }
    const r = await this.gql<{ trackView?: { success?: boolean } }>(Q.TRACK, {
      events: [event]
    }).catch(() => null)
    return Boolean(r?.trackView?.success)
  }

  async search(query: string): Promise<SearchData> {
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
