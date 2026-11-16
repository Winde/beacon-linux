import { Check } from 'iconoir-react'
import type { Card } from '@shared/types'

interface TileProps {
  card: Card
  onSelect: (card: Card) => void
  onFocus?: (card: Card) => void
  size?: 'normal' | 'large'
}

export function Tile({ card, onSelect, onFocus, size = 'normal' }: TileProps): React.JSX.Element {
  const progress = card.progress ?? 0
  const watched = card.kind === 'video' && Boolean(card.watched)
  return (
    <button
      type="button"
      className={`tile tile--${size}${watched ? ' tile--watched' : ''}`}
      data-focus
      tabIndex={-1}
      onClick={() => onSelect(card)}
      onFocus={() => onFocus?.(card)}
    >
      <span className="tile__art">
        {card.image ? (
          <img src={card.image} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile__art-empty" />
        )}
        {card.locked ? <span className="tile__badge">Members</span> : null}
        {card.kind === 'series' && card.count ? (
          <span className="tile__count">{card.count} videos</span>
        ) : null}
        {watched ? (
          <span className="tile__watched">
            <Check width={14} height={14} strokeWidth={2.4} aria-hidden />
            Watched
          </span>
        ) : null}
        {!watched && progress > 0.01 ? (
          <span className="tile__progress">
            <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="tile__text">
        <span className="tile__title">{card.title}</span>
        {card.subtitle ? <span className="tile__sub">{card.subtitle}</span> : null}
        {card.kind === 'video' && card.minutes ? (
          <span className="tile__sub">{card.minutes} min</span>
        ) : null}
      </span>
    </button>
  )
}
