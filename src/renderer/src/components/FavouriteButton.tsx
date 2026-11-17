import { Bookmark, BookmarkSolid } from 'iconoir-react'

interface FavouriteButtonProps {
  /** True when the series is already favourited in the account. */
  active: boolean
  /** The state has flipped; the write to Beacon is still in flight. */
  pending?: boolean
  onToggle: () => void
  testId?: string
}

/**
 * The one control for favouriting a series, shared by Home and the collection
 * screen. Pressing it flips the label to the new action at once and a spinner
 * stands in for the bookmark until the account has stored the change, so the
 * button never looks asleep while the request is out.
 */
export function FavouriteButton({
  active,
  pending = false,
  onToggle,
  testId = 'favourite-toggle'
}: FavouriteButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`button button--ghost${active ? ' is-active' : ''}${pending ? ' is-pending' : ''}`}
      data-focus
      data-testid={testId}
      tabIndex={-1}
      aria-pressed={active}
      aria-busy={pending}
      onClick={onToggle}
    >
      {pending ? (
        <span className="button__spinner" aria-hidden />
      ) : active ? (
        <BookmarkSolid width={18} height={18} aria-hidden />
      ) : (
        <Bookmark width={18} height={18} strokeWidth={1.7} aria-hidden />
      )}
      {active ? 'Remove from favourites' : 'Add to favourites'}
    </button>
  )
}
