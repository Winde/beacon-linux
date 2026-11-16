/** Types shared by the main process, the preload bridge and the renderer. */

export interface User {
  name: string
  tier: string | null
  active: boolean
}

export interface AuthStatus {
  signedIn: boolean
  user: User | null
}

export interface Card {
  kind: 'video' | 'series'
  slug: string
  title: string
  subtitle?: string
  image: string | null
  /** 2560-wide rendition; use for full-bleed backdrops, fall back to `image` */
  image2x?: string | null
  /** video only */
  minutes?: number | null
  /** series only */
  count?: number | null
  /** true when the account's tier is too low for this item */
  locked?: boolean
  /** 0..1 watch progress, video only */
  progress?: number
}

export interface Row {
  title: string
  items: Card[]
}

export interface HomeData {
  hero: Card[]
  rows: Row[]
}

export interface Season {
  title: string
  items: Card[]
}

export interface CollectionData {
  slug: string
  title: string
  image: string | null
  image2x: string | null
  isSeries: boolean
  seasons: Season[]
}

export interface CaptionTrack {
  label: string
  url: string
}

export interface ContentData {
  id: string
  slug: string
  title: string
  description: string
  image: string | null
  image2x: string | null
  minutes: number | null
  released: string | null
  series: { slug: string; title: string } | null
  tier: string | null
  locked: boolean
  signInNeeded: boolean
  /** seconds */
  resumeAt: number
  rows: Row[]
}

export interface PlaybackData {
  id: string
  title: string
  /** HLS master playlist URL as Beacon returned it */
  url: string
  /**
   * The same master playlist, rewritten with variants sorted best-first and
   * every URI made absolute. Play this instead of `url` to avoid starting blurry.
   */
  playlist: string | null
  /** seconds */
  duration: number | null
  /** seconds */
  resumeAt: number
  captions: CaptionTrack[]
  /** position in its collection; null when the video has no number */
  episodeNumber: number | null
  /** the collection it belongs to; null for videos filed nowhere */
  collection: { id: string; isSeries: boolean } | null
}

/** The episode the player offers once the current one is nearly over. */
export interface NextEpisode {
  slug: string
  title: string
  image: string | null
  /** series only */
  minutes?: number | null
}

/** What the player knows about the video that is ending. */
export interface NextEpisodeRequest {
  contentId: string
  collectionId: string
  isSeries: boolean
  episodeNumber: number | null
}

export interface SearchData {
  series: Card[]
  videos: Card[]
}

export interface IndexStatus {
  videos: number
  collections: number
  builtAt: string | null
  building: boolean
}

export interface ProgressReport {
  contentId: string
  /** seconds */
  position: number
  /** seconds */
  duration: number
}

export interface BeaconApi {
  auth: {
    status(): Promise<AuthStatus>
    signIn(email: string, password: string): Promise<AuthStatus>
    signOut(): Promise<void>
  }
  catalog: {
    home(): Promise<HomeData>
    collection(slug: string): Promise<CollectionData>
    content(slug: string): Promise<ContentData>
    search(query: string): Promise<SearchData>
    suggest(query: string): Promise<string[]>
    indexStatus(): Promise<IndexStatus>
  }
  playback: {
    open(slug: string): Promise<PlaybackData | null>
    next(request: NextEpisodeRequest): Promise<NextEpisode | null>
    progress(report: ProgressReport): Promise<boolean>
    captions(url: string): Promise<string>
  }
  app: {
    quit(): void
    toggleFullscreen(): void
    platform(): Promise<string>
    initialSlug(): Promise<string | null>
  }
}
