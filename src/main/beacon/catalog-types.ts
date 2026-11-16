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

export interface CatalogSnapshot {
  builtAt: number
  videos: IndexedVideo[]
  collections: IndexedCollection[]
}
