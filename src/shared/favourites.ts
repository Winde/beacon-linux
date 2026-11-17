import type { Card, FavouriteItem } from './types'

/** Draw a favourite with the same tile as the rest of Home. */
export function toCard(item: FavouriteItem): Card {
  return {
    kind: 'series',
    slug: item.slug,
    title: item.title,
    image: item.image,
    image2x: item.image2x,
    count: item.count ?? undefined
  }
}

export function isFavourite(items: FavouriteItem[], slug: string): boolean {
  return items.some((item) => item.slug === slug)
}

/**
 * The row's version of a card the member just favourited, so the button and the
 * row can change before the write reaches Beacon. The id is optional on a card;
 * the server's answer replaces this item shortly after.
 */
export function optimisticItem(card: Card): FavouriteItem | null {
  if (card.kind !== 'series') return null
  return {
    kind: 'series',
    id: card.id ?? '',
    slug: card.slug,
    title: card.title,
    image: card.image ?? null,
    image2x: card.image2x ?? null,
    count: card.count ?? null
  }
}
