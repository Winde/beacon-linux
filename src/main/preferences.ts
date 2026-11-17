import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FavouritesAnchor } from '@shared/types'

interface StoredPreferences {
  favouritesAfter?: unknown
}

const ANCHORS_MAX = 64

function isFavouritesAnchor(value: unknown): value is FavouritesAnchor {
  return typeof value === 'string' && value.length > 0 && value.length <= ANCHORS_MAX
}

/**
 * The bit of Home layout that is ours rather than Beacon's. Favourites live in
 * the member's account; only which shelf their row follows is remembered here.
 */
export class PreferencesStore {
  constructor(private readonly path: () => string) {}

  favouritesAfter(): FavouritesAnchor | null {
    try {
      const parsed = JSON.parse(readFileSync(this.path(), 'utf8')) as StoredPreferences
      return isFavouritesAnchor(parsed.favouritesAfter) ? parsed.favouritesAfter : null
    } catch {
      // No file yet, or one that is damaged. The default place is still fine.
      return null
    }
  }

  setFavouritesAfter(after: FavouritesAnchor): FavouritesAnchor {
    const value: FavouritesAnchor = isFavouritesAnchor(after) ? after : 'top'
    try {
      const target = this.path()
      mkdirSync(dirname(target), { recursive: true })
      // Write beside the target and swap it in, so a crash cannot leave half a file.
      const temporary = `${target}.tmp`
      writeFileSync(temporary, JSON.stringify({ favouritesAfter: value }), { mode: 0o600 })
      renameSync(temporary, target)
    } catch {
      // Losing the row's place is not worth crashing over; it holds this run.
    }
    return value
  }
}

export function preferencesPath(userData: string): string {
  return join(userData, 'preferences.json')
}
