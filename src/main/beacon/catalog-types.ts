/** Shapes stored in the local catalog index. */

export interface IndexedSeries {
  id: string
  name: string
  slug: string
  isSeries: boolean
}

export interface IndexedVideo {
  id: string
  slug: string
  title: string
  /** Editor-set short title for cards; absent in snapshots built before it. */
  ottTitle?: string | null
  /** ms */
  duration: number | null
  type: string | null
  tier: string | null
  level: number
  image: string | null
  /** 2560-wide rendition, for full-bleed backdrops */
  image2x: string | null
  released: string | null
  episode: number | null
  series: IndexedSeries | null
}

export interface IndexedCollection {
  id: string
  slug: string
  name: string
  isSeries: boolean
  itemCount: number | null
  released: string | null
  image: string | null
  /** 2560-wide rendition, for full-bleed backdrops */
  image2x: string | null
  portrait: string | null
}

/**
 * Bumped when the stored shape changes; a cache without the current version is
 * rebuilt rather than read.
 */
export const CATALOG_VERSION = 3

export interface CatalogSnapshot {
  version: number
  builtAt: number
  videos: IndexedVideo[]
  collections: IndexedCollection[]
}
