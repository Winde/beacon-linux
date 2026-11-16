import type { Card, Row as RowData } from '@shared/types'
import { backdropUrl, preload } from '../lib/images'
import { Tile } from './Tile'

interface RowProps extends RowData {
  onSelect: (card: Card) => void
  onFocus?: (card: Card) => void
}

export function Row({ title, items, onSelect, onFocus }: RowProps): React.JSX.Element | null {
  if (!items.length) return null

  // Warm the neighbours' full-size backdrops while the player is on this tile,
  // so scrubbing along a row finds them already decoded.
  const handleFocus = (card: Card): void => {
    onFocus?.(card)
    const index = items.findIndex((item) => item.kind === card.kind && item.slug === card.slug)
    if (index === -1) return
    for (const offset of [1, -1]) {
      const neighbour = items[index + offset]
      if (neighbour) void preload(backdropUrl(neighbour.image, neighbour.image2x))
    }
  }

  return (
    <section className="row">
      <h2 className="row__title">{title}</h2>
      <div className="row__track">
        {items.map((card) => (
          <Tile
            key={`${card.kind}:${card.slug}`}
            card={card}
            onSelect={onSelect}
            onFocus={handleFocus}
          />
        ))}
      </div>
    </section>
  )
}
