import { Home, LogOut, NavArrowLeft, Search } from 'iconoir-react'

interface NavRailProps {
  open: boolean
  showHome: boolean
  onHome: () => void
  onSearch: () => void
  /** Absent for a free-video session: there is no account to sign out of. */
  onSignOut?: () => void
}

/**
 * Slides in from the left edge when focus reaches it: content keeps the full
 * width, and the rail only exists on screen while it has focus.
 */
export function NavRail({
  open,
  showHome,
  onHome,
  onSearch,
  onSignOut
}: NavRailProps): React.JSX.Element {
  return (
    <>
      {/* Decor only: a quiet chevron in the gutter that says "there is more to
          the left", without occupying a focusable slot or any layout width. */}
      <span className="rail-hint" aria-hidden>
        <NavArrowLeft width={20} height={20} strokeWidth={1.6} />
      </span>
      <nav
        className={`rail${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        // Closed means out of the navigation order, not merely off-screen: the
        // slide-out keeps the buttons mounted (and momentarily visible) for
        // 180ms, long enough to steal a "left" press.
        inert={!open}
        aria-label="Browse"
      >
        {showHome ? (
          <button
            type="button"
            className="rail__item"
            data-focus
            data-testid="rail-home"
            tabIndex={-1}
            onClick={onHome}
          >
            <Home className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
            <span className="rail__label">Home</span>
          </button>
        ) : null}
        <button
          type="button"
          className="rail__item"
          data-focus
          data-testid="rail-search"
          tabIndex={-1}
          onClick={onSearch}
        >
          <Search className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
          <span className="rail__label">Search</span>
        </button>
        {onSignOut ? (
          <button
            type="button"
            className="rail__item rail__item--bottom"
            data-focus
            data-testid="rail-signout"
            tabIndex={-1}
            onClick={onSignOut}
          >
            <LogOut className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
            <span className="rail__label">Sign out</span>
          </button>
        ) : null}
      </nav>
    </>
  )
}
