import type { Card } from '@shared/types'
import { backdropUrl, useBackdrop } from '../lib/images'
import { FavouriteButton } from './FavouriteButton'

interface HeroProps {
  card: Card
  /** Open the card's own page (series/collection) or its details (video). */
  onOpen: (card: Card) => void
  onPlay: (card: Card) => void
  /** Omit to hide the favourite control (e.g. a preview used outside Home). */
  onToggleFavourite?: (card: Card) => void
  inFavourites?: boolean
  /** The favourite write for this card is still in flight. */
  favouritePending?: boolean
}

/**
 * The home hero follows focus, so it can preview a video or a category
 * (series/collection). A category is a link to a deeper screen, not something
 * that plays, so it gets a Browse button instead of Play; a locked video opens
 * its details, where the membership requirement is explained.
 */
export function Hero({
  card,
  onOpen,
  onPlay,
  onToggleFavourite,
  inFavourites = false,
  favouritePending = false
}: HeroProps): React.JSX.Element {
  const isVideo = card.kind === 'video'
  const playable = isVideo && !card.locked
  const resuming = playable && (card.progress ?? 0) > 0.01
  const sub = isVideo
    ? [card.subtitle, card.minutes ? `${card.minutes} min` : null]
    : [card.count ? `${card.count} videos` : null]
  // Cards carry thumbnail URLs; the hero needs its own size. The card's own
  // thumbnail is already in the browser cache from its tile, so it stands in —
  // blurred — while the full-size backdrop decodes.
  const shown = useBackdrop(backdropUrl(card.image, card.image2x))

  return (
    <section className="hero">
      <div className="hero__art">
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
      </div>
      <div className="hero__body">
        <p className="hero__eyebrow">Featured</p>
        <h1 className="hero__title">{card.title}</h1>
        <p className="hero__sub">{sub.filter(Boolean).join(' · ')}</p>
        <div className="button-row" data-focus-row>
          <button
            type="button"
            className="button button--primary"
            data-focus
            data-testid={playable ? 'hero-play' : isVideo ? 'hero-details' : 'hero-browse'}
            tabIndex={-1}
            onClick={() => (playable ? onPlay(card) : onOpen(card))}
          >
            {!isVideo ? 'Browse' : card.locked ? 'Details' : resuming ? 'Resume' : 'Play'}
          </button>
          {/* Favourites are collections: a video hero has nothing to save. */}
          {onToggleFavourite && !isVideo ? (
            <FavouriteButton
              active={inFavourites}
              pending={favouritePending}
              onToggle={() => onToggleFavourite(card)}
              testId="hero-favourite"
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}
