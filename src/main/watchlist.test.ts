import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { accountKey, GUEST_ACCOUNT, WatchlistStore, watchlistPath } from './watchlist'
import type { WatchlistEntry } from './watchlist'

let directory: string
let file: string
let store: WatchlistStore

const MEMBER = 'Member@Example.com'
const OTHER = 'other@example.com'

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return { kind: 'video', id: 'v1', addedAt: 1, ...overrides }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'beacon-watchlist-'))
  file = watchlistPath(directory)
  store = new WatchlistStore(() => file)
})

describe('accountKey', () => {
  it('files an address case- and space-insensitively', () => {
    expect(accountKey(' Member@Example.com ')).toBe('member@example.com')
  })

  it('uses one shared bucket while nobody is signed in', () => {
    expect(accountKey(null)).toBe(GUEST_ACCOUNT)
    expect(accountKey('')).toBe(GUEST_ACCOUNT)
  })
})

describe('WatchlistStore', () => {
  it('starts empty', () => {
    expect(store.list(MEMBER)).toEqual({ items: [], rowsAbove: null })
  })

  it('stores only the identity of a title', () => {
    store.add(MEMBER, entry())

    const written = JSON.parse(readFileSync(file, 'utf8')) as {
      accounts: Record<string, { items: Record<string, unknown>[] }>
    }
    expect(written.accounts['member@example.com'].items).toEqual([
      { kind: 'video', id: 'v1', addedAt: 1 }
    ])
  })

  it('keeps the newest title first', () => {
    store.add(MEMBER, entry({ id: 'v1' }))
    store.add(MEMBER, entry({ id: 'v2' }))

    expect(store.list(MEMBER).items.map((item) => item.id)).toEqual(['v2', 'v1'])
  })

  it('does not save the same title twice', () => {
    store.add(MEMBER, entry({ addedAt: 1 }))
    const data = store.add(MEMBER, entry({ addedAt: 2 }))

    expect(data.items).toHaveLength(1)
    expect(data.items[0].addedAt).toBe(1)
  })

  it('keeps the same id separate for a video and a series', () => {
    store.add(MEMBER, entry({ kind: 'video', id: 'shared' }))
    const data = store.add(MEMBER, entry({ kind: 'series', id: 'shared' }))

    expect(data.items).toHaveLength(2)
  })

  it('removes only the id asked for', () => {
    store.add(MEMBER, entry())
    store.add(MEMBER, entry({ id: 'v2' }))

    const data = store.remove(MEMBER, 'video', 'v1')

    expect(data.items.map((item) => item.id)).toEqual(['v2'])
  })

  it('keeps accounts apart, however their address was typed', () => {
    store.add(MEMBER, entry())
    store.add(OTHER, entry({ id: 'other' }))

    expect(store.list('member@example.com').items.map((item) => item.id)).toEqual(['v1'])
    expect(store.list(OTHER).items.map((item) => item.id)).toEqual(['other'])
    expect(store.list(null).items).toEqual([])
  })

  it('gives a guest a list of their own', () => {
    store.add(null, entry())

    expect(store.list(null).items).toHaveLength(1)
    expect(store.list(MEMBER).items).toEqual([])
  })

  it('remembers where the row was moved, per account', () => {
    store.setPosition(MEMBER, 2)

    expect(store.list(MEMBER).rowsAbove).toBe(2)
    expect(store.list(OTHER).rowsAbove).toBeNull()

    store.setPosition(OTHER, 0)
    expect(store.list(OTHER).rowsAbove).toBe(0)
  })

  it('normalises a position from outside', () => {
    expect(store.setPosition(MEMBER, -3).rowsAbove).toBeNull()
    expect(store.setPosition(MEMBER, 2.8).rowsAbove).toBe(2)
  })

  it('clears one account without touching the others', () => {
    store.add(MEMBER, entry())
    store.add(OTHER, entry({ id: 'other' }))

    expect(store.clear(MEMBER)).toEqual({ items: [], rowsAbove: null })
    expect(store.list(MEMBER).items).toEqual([])
    expect(store.list(OTHER).items).toHaveLength(1)
  })

  it('forgets the file once the last list is deleted', () => {
    store.add(MEMBER, entry())
    store.clear(MEMBER)

    expect(existsSync(file)).toBe(false)
  })

  it('survives a damaged file', () => {
    writeFileSync(file, 'not json')

    expect(store.list(MEMBER).items).toEqual([])
    expect(store.add(MEMBER, entry()).items).toHaveLength(1)
  })

  it('drops entries that have no identity', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        accounts: {
          [accountKey(MEMBER)]: {
            items: [
              { kind: 'video', id: 'ok', addedAt: 1 },
              { kind: 'unknown', id: 'bad', addedAt: 1 },
              { kind: 'video', id: '', addedAt: 1 },
              { kind: 'video', slug: 'old-shape', title: 'Old', addedAt: 1 },
              'nonsense'
            ],
            rowsAbove: -1
          }
        }
      })
    )

    const data = store.list(MEMBER)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].id).toBe('ok')
    expect(data.rowsAbove).toBeNull()
  })

  it('never throws when the file cannot be written', () => {
    const blocker = join(directory, 'blocker')
    writeFileSync(blocker, 'x')
    const broken = new WatchlistStore(() => join(blocker, 'watchlist.json'))

    expect(() => broken.add(MEMBER, entry())).not.toThrow()
    expect(broken.list(MEMBER).items).toEqual([])
  })
})
