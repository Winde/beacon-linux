import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PreferencesStore } from './preferences'

const dirs: string[] = []

function newStore(): { store: PreferencesStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-prefs-'))
  dirs.push(dir)
  const path = join(dir, 'preferences.json')
  return { store: new PreferencesStore(() => path), path }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PreferencesStore', () => {
  it('has no anchor until one is chosen', () => {
    const { store } = newStore()

    expect(store.favouritesAfter()).toBeNull()
  })

  it('remembers the shelf the Favourites row follows', () => {
    const { store, path } = newStore()

    expect(store.setFavouritesAfter('featured')).toBe('featured')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ favouritesAfter: 'featured' })
    expect(new PreferencesStore(() => path).favouritesAfter()).toBe('featured')
  })

  it('falls back to the top for an empty or oversized anchor', () => {
    const { store, path } = newStore()

    expect(store.setFavouritesAfter('')).toBe('top')
    expect(store.favouritesAfter()).toBe('top')
    expect(store.setFavouritesAfter('x'.repeat(65))).toBe('top')
    expect(new PreferencesStore(() => path).favouritesAfter()).toBe('top')
  })

  it('ignores a damaged file', () => {
    const { store, path } = newStore()
    writeFileSync(path, '{not json')

    expect(store.favouritesAfter()).toBeNull()
  })

  it('ignores a file with the wrong shape', () => {
    const { store, path } = newStore()
    writeFileSync(path, JSON.stringify({ favouritesAfter: 42 }))

    expect(store.favouritesAfter()).toBeNull()
  })

  it('keeps the choice for this run when the file cannot be replaced', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beacon-prefs-'))
    dirs.push(directory)
    // Point at a directory: the temporary file can be written, but the swap
    // onto a directory fails. Losing the file must not lose the choice.
    const store = new PreferencesStore(() => directory)

    expect(store.setFavouritesAfter('featured')).toBe('featured')
    expect(store.favouritesAfter()).toBeNull()
  })
})
