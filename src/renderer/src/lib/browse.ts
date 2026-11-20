import type { Card } from '@shared/types'

/** The orders Beacon's own Series and Collections lists offer. */
export type BrowseSort = 'newest' | 'oldest' | 'alpha' | 'reverse-alpha'

export const BROWSE_SORTS: { value: BrowseSort; label: string; title: string }[] = [
  { value: 'newest', label: 'Newest', title: 'Newest collection release date' },
  { value: 'oldest', label: 'Oldest', title: 'Oldest collection release date' },
  { value: 'alpha', label: 'A-Z', title: 'Sort by name, A to Z' },
  { value: 'reverse-alpha', label: 'Z-A', title: 'Sort by name, Z to A' }
]

const byTitle = (a: Card, b: Card): number => a.title.localeCompare(b.title)

/** Missing dates sort after real ones, whichever direction is chosen. */
const time = (card: Card): number | null => {
  if (!card.released) return null
  const value = Date.parse(card.released)
  return Number.isFinite(value) ? value : null
}

/**
 * The official apps sort both lists by the collection's `releaseDate`; this is
 * the same field the index stores as `released`. A missing date is kept last
 * rather than pretending the item is new (or older than everything else).
 */
export function sortBrowseCards(cards: Card[], sort: BrowseSort): Card[] {
  const sorted = [...cards]
  if (sort === 'alpha') return sorted.sort(byTitle)
  if (sort === 'reverse-alpha') return sorted.sort((a, b) => byTitle(b, a))

  const direction = sort === 'newest' ? -1 : 1
  return sorted.sort((a, b) => {
    const at = time(a)
    const bt = time(b)
    if (at === null && bt === null) return byTitle(a, b)
    if (at === null) return 1
    if (bt === null) return -1
    return (at - bt) * direction || byTitle(a, b)
  })
}
