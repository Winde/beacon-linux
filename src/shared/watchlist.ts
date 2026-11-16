import type { Card, WatchlistItem } from './types'

/** Draw a saved item with the same tile as the rest of Home. */
export function toCard(item: WatchlistItem): Card {
  return {
    kind: item.kind,
    slug: item.slug,
    title: item.title,
    subtitle: item.subtitle || undefined,
    image: item.image,
    image2x: item.image2x,
    minutes: item.minutes ?? undefined,
    count: item.count ?? undefined
  }
}

export function isWatchlisted(
  items: WatchlistItem[],
  kind: Card['kind'],
  slug: string
): boolean {
  return items.some((item) => item.kind === kind && item.slug === slug)
}
