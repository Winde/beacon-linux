import { Home, LogOut, NavArrowLeft, RefreshDouble, Search, ViewGrid } from 'iconoir-react'

interface NavRailProps {
  open: boolean
  showHome: boolean
  onHome: () => void
  onBrowse: () => void
  onSearch: () => void
  /** Absent for a free-video session: there is no account to sign out of. */
  onSignOut?: () => void
  /** The running version, shown at the foot of the rail. */
  version: string | null
  /** A newer release the last check found, named on the button instead. */
  availableVersion?: string | null
  /** True while a check is in flight: the button says so and stays put. */
  checking: boolean
  onCheckForUpdates: () => void
}

/**
 * Slides in from the left edge when focus reaches it: content keeps the full
 * width, and the rail only exists on screen while it has focus.
 */
export function NavRail({
  open,
  showHome,
  onHome,
  onBrowse,
  onSearch,
  onSignOut,
  version,
  availableVersion,
  checking,
  onCheckForUpdates
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
          data-testid="rail-browse"
          tabIndex={-1}
          onClick={onBrowse}
        >
          <ViewGrid className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
          <span className="rail__label">Browse</span>
        </button>
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

        {/* App actions sit apart from browsing, at the foot of the rail. The
            version line stays under them, always: it is the one thing here that
            is read rather than pressed. */}
        <div className="rail__footer">
          <button
            type="button"
            className="rail__item"
            data-focus
            data-testid="rail-update"
            tabIndex={-1}
            disabled={checking}
            aria-busy={checking}
            onClick={onCheckForUpdates}
          >
            {checking ? (
              <span className="rail__spinner" aria-hidden />
            ) : (
              <RefreshDouble
                className="rail__icon"
                width={20}
                height={20}
                strokeWidth={1.7}
                aria-hidden
              />
            )}
            <span className="rail__label">
              {checking
                ? 'Checking…'
                : availableVersion
                  ? `Update to v${availableVersion}`
                  : 'Check for updates'}
            </span>
          </button>
          {onSignOut ? (
            <button
              type="button"
              className="rail__item"
              data-focus
              data-testid="rail-signout"
              tabIndex={-1}
              onClick={onSignOut}
            >
              <LogOut className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
              <span className="rail__label">Sign out</span>
            </button>
          ) : null}
          <p className="rail__version" data-testid="rail-version">
            {version ? `v${version}` : ''}
          </p>
        </div>
      </nav>
    </>
  )
}
