import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FavouritesData, HomeData } from '@shared/types'
import { HomeStore } from './home-store'

let directory: string

function feed(title = 'Featured One'): HomeData {
  return {
    hero: [
      {
        kind: 'video',
        slug: 'feat-1',
        title,
        image: null,
        image2x: null
      }
    ],
    rows: [
      {
        id: 'latest',
        kind: 'latest',
        title: 'Latest',
        items: [
          {
            kind: 'video',
            slug: 'a',
            title: 'Episode a',
            image: null,
            image2x: null
          }
        ]
      }
    ]
  }
}

function favourites(title = 'Campaign 1'): FavouritesData {
  return {
    items: [
      {
        kind: 'series',
        id: 's1',
        slug: 'campaign-1',
        title,
        image: null,
        image2x: null,
        count: 12
      }
    ],
    after: 'featured'
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'beacon-home-store-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('HomeStore', () => {
  it('round-trips the feed and the Favourites row for its account', () => {
    const store = new HomeStore(() => directory)
    store.saveHome('member@example.com', feed())
    store.saveFavourites('member@example.com', favourites())

    const cached = store.read('member@example.com')

    expect(cached?.home?.hero[0]?.title).toBe('Featured One')
    expect(cached?.favourites?.items[0]?.title).toBe('Campaign 1')
    expect(cached?.favourites?.after).toBe('featured')
  })

  it('keeps each half when the other is written later', () => {
    const store = new HomeStore(() => directory)
    store.saveFavourites('member@example.com', favourites())
    store.saveHome('member@example.com', feed())

    expect(store.read('member@example.com')?.home).not.toBeNull()
    expect(store.read('member@example.com')?.favourites).not.toBeNull()
  })

  it('has nothing before the first successful fetch', () => {
    expect(new HomeStore(() => directory).read('member@example.com')).toBeNull()
  })

  it('deletes a slot that belongs to another account', () => {
    const store = new HomeStore(() => directory)
    store.saveHome('member@example.com', feed())
    store.saveFavourites('member@example.com', favourites())
    const path = join(directory, 'home-cache.json')
    expect(existsSync(path)).toBe(true)

    expect(store.read('other@example.com')).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('deletes a slot written by another schema version', () => {
    const store = new HomeStore(() => directory)
    store.saveHome('member@example.com', feed())
    const path = join(directory, 'home-cache.json')
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { version: number }
    stored.version += 1
    writeFileSync(path, JSON.stringify(stored))

    // A new instance is the next launch: no in-memory copy to answer from.
    expect(new HomeStore(() => directory).read('member@example.com')).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('keeps a version 1 feed and adds favourites on the next write', () => {
    const path = join(directory, 'home-cache.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        scope: 'member@example.com',
        savedAt: Date.now(),
        data: feed()
      })
    )
    const store = new HomeStore(() => directory)

    expect(store.read('member@example.com')?.home?.hero).toHaveLength(1)
    expect(store.read('member@example.com')?.favourites).toBeNull()

    store.saveFavourites('member@example.com', favourites())

    const stored = JSON.parse(readFileSync(path, 'utf8')) as { version: number }
    expect(stored.version).toBe(2)
    expect(store.read('member@example.com')?.favourites?.items).toHaveLength(1)
  })

  it('deletes a corrupt file instead of trying it every launch', () => {
    const path = join(directory, 'home-cache.json')
    writeFileSync(path, '{ not json')

    expect(new HomeStore(() => directory).read('member@example.com')).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('deletes a feed whose shape is wrong', () => {
    const path = join(directory, 'home-cache.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        scope: 'member@example.com',
        savedAt: Date.now(),
        home: { hero: [], rows: [{ id: 'latest', title: 'Latest', items: [{}] }] }
      })
    )

    expect(new HomeStore(() => directory).read('member@example.com')).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('deletes a Favourites row whose shape is wrong', () => {
    const path = join(directory, 'home-cache.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        scope: 'member@example.com',
        savedAt: Date.now(),
        favourites: { items: [{ kind: 'video', id: 'x' }], after: null }
      })
    )

    expect(new HomeStore(() => directory).read('member@example.com')).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('does not replace a useful feed with an empty answer', () => {
    const store = new HomeStore(() => directory)
    store.saveHome('member@example.com', feed())
    store.saveHome('member@example.com', { hero: [], rows: [] })

    expect(store.read('member@example.com')?.home?.hero).toHaveLength(1)
  })

  it('accepts an empty Favourites row, so the next launch knows there is none', () => {
    const store = new HomeStore(() => directory)
    store.saveFavourites('member@example.com', { items: [], after: null })

    expect(store.read('member@example.com')?.favourites).toEqual({ items: [], after: null })
  })

  it('clears the slot and any half-written file', () => {
    const store = new HomeStore(() => directory)
    store.saveHome('member@example.com', feed())
    writeFileSync(join(directory, 'home-cache.json.tmp'), 'partial')

    store.clear()

    expect(existsSync(join(directory, 'home-cache.json'))).toBe(false)
    expect(existsSync(join(directory, 'home-cache.json.tmp'))).toBe(false)
  })

  it('does not throw when the directory cannot be used', () => {
    // A file where the directory should be makes every write fail.
    writeFileSync(join(directory, 'blocked'), 'x')
    const store = new HomeStore(() => join(directory, 'blocked'))
    expect(() => store.saveHome('member@example.com', feed())).not.toThrow()
    expect(() => store.saveFavourites('member@example.com', favourites())).not.toThrow()
    expect(existsSync(join(directory, 'blocked', 'home-cache.json'))).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })
})
