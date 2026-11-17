import type { NextEpisode } from '@shared/types'
import { UPNEXT_WINDOW } from './model'

interface UpNextCardProps {
  offer: NextEpisode
  remaining: number
  onPlay: () => void
  onDismiss: () => void
}

/** The "Up next" card over the ending, with its countdown when autoplay is on. */
export function UpNextCard({
  offer,
  remaining,
  onPlay,
  onDismiss
}: UpNextCardProps): React.JSX.Element {
  const seconds = Math.ceil(remaining)
  const counting = !offer.autoplayDisabled

  return (
    <div className="player__upnext">
      <button
        type="button"
        className="player__upnext-card"
        tabIndex={-1}
        aria-label={`Play next: ${offer.title}`}
        onClick={onPlay}
      >
        {offer.image ? <img className="player__upnext-image" src={offer.image} alt="" /> : null}
        <span className="player__upnext-text">
          <span className="player__upnext-label">Up next</span>
          <span className="player__upnext-title">{offer.title}</span>
          <span className="player__upnext-meta">
            {offer.minutes ? `${offer.minutes} min · ` : ''}
            {offer.autoplayDisabled
              ? 'Play next'
              : seconds > 0
                ? `Playing in ${seconds}s`
                : 'Playing now'}
          </span>
        </span>
      </button>
      {counting ? (
        <div className="player__upnext-timer" aria-hidden>
          <div
            className="player__upnext-fill"
            style={{ width: `${(remaining / UPNEXT_WINDOW) * 100}%` }}
          />
        </div>
      ) : null}
      <button type="button" className="player__upnext-cancel" tabIndex={-1} onClick={onDismiss}>
        {offer.autoplayDisabled ? 'Dismiss' : 'Keep watching'}
      </button>
    </div>
  )
}
