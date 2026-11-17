import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface StoredPreferences {
  rowsAbove: number | null
}

/**
 * The bit of Home layout that is ours rather than Beacon's. Favourites live in
 * the member's account; only where their row sits is remembered on this device.
 */
export class PreferencesStore {
  constructor(private readonly path: () => string) {}

  rowsAbove(): number | null {
    try {
      const parsed = JSON.parse(readFileSync(this.path(), 'utf8')) as Partial<StoredPreferences>
      return typeof parsed.rowsAbove === 'number' &&
        Number.isInteger(parsed.rowsAbove) &&
        parsed.rowsAbove >= 0
        ? parsed.rowsAbove
        : null
    } catch {
      // No file yet, or one that is damaged. The default place is still fine.
      return null
    }
  }

  setRowsAbove(rowsAbove: number): number | null {
    const value = Number.isFinite(rowsAbove) && rowsAbove >= 0 ? Math.floor(rowsAbove) : null
    try {
      const target = this.path()
      mkdirSync(dirname(target), { recursive: true })
      // Write beside the target and swap it in, so a crash cannot leave half a file.
      const temporary = `${target}.tmp`
      writeFileSync(temporary, JSON.stringify({ rowsAbove: value }), { mode: 0o600 })
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
