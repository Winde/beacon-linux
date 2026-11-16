import type { Card } from '@shared/types'

interface HeroProps {
  card: Card
  onPlay: (card: Card) => void
}

export function Hero({ card, onPlay }: HeroProps): React.JSX.Element {
  const resuming = (card.progress ?? 0) > 0.01
  return (
    <section className="hero">
      {card.image ? <img className="hero__bg" src={card.image} alt="" draggable={false} /> : null}
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
