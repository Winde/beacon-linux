import type { Card, Row as RowData } from '@shared/types'
import { Tile } from './Tile'

interface RowProps extends RowData {
  onSelect: (card: Card) => void
  onFocus?: (card: Card) => void
}

export function Row({ title, items, onSelect, onFocus }: RowProps): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <section className="row">
      <h2 className="row__title">{title}</h2>
      <div className="row__track">
        {items.map((card) => (
          <Tile
            key={`${card.kind}:${card.slug}`}
            card={card}
            onSelect={onSelect}
            onFocus={onFocus}
          />
        ))}
      </div>
    </section>
  )
}
