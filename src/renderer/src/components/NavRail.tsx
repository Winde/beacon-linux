import { Home, LogOut, RefreshDouble, Search, ViewGrid } from 'iconoir-react'

export type RailSection = 'home' | 'browse' | 'search'

interface NavRailProps {
  /** The page family currently on screen, marked with the accent. */
  active: RailSection
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
 * A permanent icon rail, YouTube-style. At rest it is a narrow strip of icons;
 * while it holds focus it expands to reveal the labels. It reserves its
 * collapsed width, so the shelves never shift when the labels slide over them.
 */
export function NavRail({
  active,
  onHome,
  onBrowse,
  onSearch,
  onSignOut,
  version,
  availableVersion,
  checking,
  onCheckForUpdates
}: NavRailProps): React.JSX.Element {
  const itemClass = (section: RailSection): string =>
    `rail__item${active === section ? ' is-active' : ''}`

  return (
    <nav className="rail" aria-label="Main">
      <button
        type="button"
        className={itemClass('home')}
        data-focus
        data-testid="rail-home"
        tabIndex={-1}
        title="Home"
        aria-current={active === 'home' ? 'page' : undefined}
        onClick={onHome}
      >
        <Home className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
        <span className="rail__label">Home</span>
      </button>
      <button
        type="button"
        className={itemClass('browse')}
        data-focus
        data-testid="rail-browse"
        tabIndex={-1}
        title="Browse"
        aria-current={active === 'browse' ? 'page' : undefined}
        onClick={onBrowse}
      >
        <ViewGrid className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
        <span className="rail__label">Browse</span>
      </button>
      <button
        type="button"
        className={itemClass('search')}
        data-focus
        data-testid="rail-search"
        tabIndex={-1}
        title="Search"
        aria-current={active === 'search' ? 'page' : undefined}
        onClick={onSearch}
      >
        <Search className="rail__icon" width={20} height={20} strokeWidth={1.7} aria-hidden />
        <span className="rail__label">Search</span>
      </button>

      {/* App and account actions sit apart from browsing, at the foot of the
          rail. The version line stays under them: it is read, never pressed. */}
      <div className="rail__footer">
        <button
          type="button"
          className="rail__item"
          data-focus
          data-testid="rail-update"
          tabIndex={-1}
          title="Check for updates"
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
            title="Sign out"
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
  )
}
