import type { Card } from '@shared/types'
import { backdropUrl, useBackdrop } from '../lib/images'

interface HeroProps {
  card: Card
  onPlay: (card: Card) => void
}

export function Hero({ card, onPlay }: HeroProps): React.JSX.Element {
  const resuming = (card.progress ?? 0) > 0.01
  // Cards carry thumbnail URLs; the hero needs its own size. The card's own
  // thumbnail is already in the browser cache from its tile, so it stands in —
  // blurred — while the full-size backdrop decodes.
  const shown = useBackdrop(backdropUrl(card.image, card.image2x))

  return (
    <section className="hero">
      {card.image ? (
        <img
          key={card.image}
          className="hero__bg hero__bg--stand-in"
          src={card.image}
          alt=""
          draggable={false}
          aria-hidden
        />
      ) : null}
      {shown ? (
        <img
          key={shown}
          className="hero__bg hero__bg--fresh"
          src={shown}
          alt=""
          draggable={false}
          decoding="async"
        />
      ) : null}
      <div className="hero__shade" />
      <div className="hero__body">
        <p className="hero__eyebrow">Featured</p>
        <h1 className="hero__title">{card.title}</h1>
        <p className="hero__sub">
          {[card.subtitle, card.minutes ? `${card.minutes} min` : null].filter(Boolean).join(' · ')}
        </p>
        <button
          type="button"
          className="button button--primary"
          data-focus
          data-testid="hero-play"
          tabIndex={-1}
          onClick={() => onPlay(card)}
        >
          {resuming ? 'Resume' : 'Play'}
        </button>
      </div>
    </section>
  )
}
