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

/**
 * Where the main process can keep a session. `plaintext` means Linux selected
 * safeStorage's `basic_text` backend, which only obfuscates; both it and
 * `unavailable` mean nothing is written and the member signs in each launch.
 */
export type CredentialStorage = 'keyring' | 'plaintext' | 'unavailable'

export interface Card {
  kind: 'video' | 'series'
  /** Beacon's content id; the stable identity behind the slug. */
  id?: string
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
  /** video only; true once the account has finished it */
  watched?: boolean
}

/** What a shelf is for; the server id below is its identity. */
export type HomeRowKind = 'continue' | 'featured' | 'series' | 'latest' | 'favourites'

export interface Row {
  title: string
  items: Card[]
}

/** A Home shelf carries the block id Beacon gave it, and our own for Favourites. */
export interface HomeRow extends Row {
  id: string
  kind: HomeRowKind
}

/** `top`, or the id of the block the Favourites row follows. */
export type FavouritesAnchor = string

/**
 * One favourited series/collection, hydrated for the row. Beacon stores the
 * favourite; only ids come back, so the rest is looked up in the local catalog.
 */
export interface FavouriteItem {
  kind: 'series'
  /** Beacon's collection id. */
  id: string
  slug: string
  title: string
  image: string | null
  image2x: string | null
  count: number | null
}

export interface FavouritesData {
  items: FavouriteItem[]
  /** null keeps the default: after Continue watching, else at the top. */
  after: FavouritesAnchor | null
}

export interface HomeData {
  hero: Card[]
  rows: HomeRow[]
}

export interface Season {
  title: string
  items: Card[]
}

export interface CollectionData {
  id: string
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
  /** The rest of Beacon's page body; shown when the member expands it. */
  continuedSummary: string
  image: string | null
  image2x: string | null
  minutes: number | null
  released: string | null
  series: { slug: string; title: string } | null
  tier: string | null
  locked: boolean
  signInNeeded: boolean
  /** whether a signed-in account's watch state can be read or changed */
  signedIn: boolean
  /** true once the account has finished this video */
  watched: boolean
  /** seconds */
  resumeAt: number
  rows: Row[]
}

/** The watch state of one video after a mark or a read. */
export interface WatchState {
  watched: boolean
  /** 0..1 */
  progress: number
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
  /** the series editor disabled automatic playback; the card stays manual */
  autoplayDisabled: boolean
}

/** What the player knows about the video that is ending. */
export interface NextEpisodeRequest {
  contentId: string
  collectionId: string
  isSeries: boolean
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
    storage(): Promise<CredentialStorage>
  }
  catalog: {
    home(): Promise<HomeData>
    collection(slug: string): Promise<CollectionData>
    content(slug: string): Promise<ContentData>
    search(query: string): Promise<SearchData>
    suggest(query: string): Promise<string[]>
    indexStatus(): Promise<IndexStatus>
  }
  /**
   * Beacon's own favourites for this account: collections only, and empty when
   * nobody is signed in. The row's position on Home is the one local part.
   */
  favourites: {
    list(): Promise<FavouritesData>
    add(card: Card): Promise<FavouritesData>
    remove(slug: string): Promise<FavouritesData>
    /** Persist where the Favourites row sits, relative to a named shelf. */
    setPosition(after: FavouritesAnchor): Promise<FavouritesData>
  }
  playback: {
    open(slug: string): Promise<PlaybackData | null>
    next(request: NextEpisodeRequest): Promise<NextEpisode | null>
    /** Tell Beacon a view has started, before there is a position to report. */
    start(contentId: string): Promise<boolean>
    progress(report: ProgressReport): Promise<boolean>
    /** Send queued progress now, e.g. when the player closes. */
    flush(): Promise<boolean>
    captions(url: string): Promise<string>
  }
  watch: {
    /** Mark an episode watched or unwatched for the signed-in account. */
    mark(slug: string, watched: boolean): Promise<WatchState>
  }
  app: {
    quit(): void
    toggleFullscreen(): void
    platform(): Promise<string>
    initialSlug(): Promise<string | null>
  }
}
