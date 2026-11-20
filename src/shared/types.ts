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
 * What the stored session says without asking the account. Enough to choose
 * the first screen and the cache slot; `AuthStatus` still confirms it.
 */
export interface SessionInfo {
  signedIn: boolean
  /** The account the session belongs to, or null for a guest. */
  email: string | null
}

/**
 * Where the main process can keep a session. `plaintext` means Linux selected
 * safeStorage's `basic_text` backend: the session is saved, but only
 * obfuscated. `unavailable` means there is nowhere to keep it.
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
  /** series only; Beacon's collection release date, used by the Browse sort */
  released?: string | null
  /** true when the account's tier is too low for this item */
  locked?: boolean
  /** 0..1 watch progress, video only */
  progress?: number
  /** video only; true once the account has finished it */
  watched?: boolean
}

/** What a shelf is for; the server id below is its identity. */
export type HomeRowKind = 'continue' | 'featured' | 'series' | 'latest' | 'listen' | 'favourites'

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

/** What the player has to draw: a video surface, or audio with artwork. */
export type PlaybackKind = 'video' | 'audio'

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
  /** Video wins when it exists; audio is the fallback for podcasts. */
  kind: PlaybackKind
  /** The collection this video is filed under; the header links to it. */
  series: { slug: string; title: string; isSeries: boolean } | null
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
  /** Video when the item has one, otherwise audio. */
  kind: PlaybackKind
  /** Square podcast artwork, for the audio surface. */
  image?: string | null
  image2x?: string | null
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

/** Every collection in the catalog, split the way Beacon files them. */
export interface BrowseData {
  series: Card[]
  collections: Card[]
}

/**
 * The collection and episode pages the last launch left behind, for a first
 * paint before any request. Both lists are account-specific and bounded.
 */
export interface CachedPages {
  collections: CollectionData[]
  contents: ContentData[]
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

/** What GitHub's latest stable release says about this build. */
export interface UpdateInfo {
  /** The version running now, without a leading `v`. */
  current: string
  /** The newest stable release, without a leading `v`. */
  latest: string
  /** True when `latest` is newer than `current`. */
  available: boolean
  /**
   * True when this build can replace itself: it runs from a writable AppImage.
   * Otherwise there is only a download to point at.
   */
  canInstall: boolean
}

/** One release's notes, for the changelog shown before an update. */
export interface ReleaseNote {
  /** The version the notes belong to, without a leading `v`. */
  version: string
  /** The release body as GitHub stores it (Markdown), empty when there is none. */
  notes: string
}

export interface BeaconApi {
  auth: {
    /** The stored session alone: local, no network, no token refresh. */
    session(): Promise<SessionInfo>
    status(): Promise<AuthStatus>
    signIn(email: string, password: string): Promise<AuthStatus>
    signOut(): Promise<void>
    storage(): Promise<CredentialStorage>
  }
  catalog: {
    home(): Promise<HomeData>
    /**
     * Last launch's feed for the current account, for the first paint. Null
     * when there is none, it belongs to another account, or its version is old.
     */
    cachedHome(): Promise<HomeData | null>
    /** Last launch's collection and episode pages for this account. */
    cachedPages(): Promise<CachedPages>
    browse(): Promise<BrowseData>
    /** Null when the CMS no longer has this series/collection. */
    collection(slug: string): Promise<CollectionData | null>
    /** Null when the CMS no longer has this episode. */
    content(slug: string): Promise<ContentData | null>
    search(query: string): Promise<SearchData>
    suggest(query: string): Promise<string[]>
  }
  /**
   * Beacon's own favourites for this account: collections only, and empty when
   * nobody is signed in. The row's position on Home is the one local part.
   */
  favourites: {
    /** Last launch's row for this account, read before the first paint. */
    cached(): Promise<FavouritesData | null>
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
    /** The running version, without a leading `v`. */
    version(): Promise<string>
  }
  /**
   * GitHub Releases is the only update channel. `install` replaces this
   * AppImage in place and restarts the app; the promise rejects when that is
   * not possible.
   */
  updates: {
    check(): Promise<UpdateInfo>
    /**
     * Notes for every stable release between the running version and the one
     * a check found, newest first. Read when the dialog opens, and cached in
     * the main process for as long as that release is pending.
     */
    notes(): Promise<ReleaseNote[]>
    install(): Promise<void>
  }
}
