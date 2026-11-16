import { Bookmark, BookmarkSolid } from 'iconoir-react'

interface WatchlistButtonProps {
  /** True when the title is already saved. */
  active: boolean
  onToggle: () => void
  testId?: string
}

/**
 * The one control for saving a title, shared by the hero and the two title
 * screens. Watching something never touches the list; only this does.
 */
export function WatchlistButton({
  active,
  onToggle,
  testId = 'watchlist-toggle'
}: WatchlistButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`button button--ghost${active ? ' is-active' : ''}`}
      data-focus
      data-testid={testId}
      tabIndex={-1}
      aria-pressed={active}
      onClick={onToggle}
    >
      {active ? (
        <BookmarkSolid width={18} height={18} aria-hidden />
      ) : (
        <Bookmark width={18} height={18} strokeWidth={1.7} aria-hidden />
      )}
      {active ? 'Remove from watchlist' : 'Add to watchlist'}
    </button>
  )
}
