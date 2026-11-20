/** The untyped CMS shapes the client reads. */

export interface CmsThumb {
  sizes?: {
    landscape?: { url?: string } | null
    landscape2x?: { url?: string } | null
    portrait?: { url?: string } | null
    square?: { url?: string } | null
  } | null
}

export interface CmsCard {
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
export interface ProgressInfo {
  /** 0..1 */
  progress: number
  position: number | null
}

export interface CmsCollection {
  id: string
  name: string
  slug: string
  isSeries?: boolean
  itemCount?: number | null
  releaseDate?: string | null
  thumbnail?: CmsThumb | null
}

/** A home block as it arrives from Beacon; only some types carry fields. */
export interface PlatformExclusions {
  ios?: boolean
  android?: boolean
  web?: boolean
}

export interface BlockContent {
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

export interface BlockCollection {
  __typename?: string
  id: string
  name: string
  slug: string
  itemCount?: number | null
  thumbnail?: CmsThumb | null
}

export interface HomeBlock {
  __typename?: string
  id?: string
  title?: string
  limit?: number | null
  content?: (BlockContent | BlockCollection)[]
  items?: { item?: { value?: BlockContent | BlockCollection } }[]
  excludedPlatforms?: PlatformExclusions | null
}

export interface ContinueWatchingDoc {
  videoProgress?: number
  videoProgressSeconds?: number
  content?: CmsCard
}

export interface ContinueWatchingResult {
  continueWatching?: { docs?: ContinueWatchingDoc[] }
}
