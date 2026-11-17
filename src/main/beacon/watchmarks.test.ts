import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WatchMarkStore } from './watchmarks'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const dirs: string[] = []

function newStore(): { store: WatchMarkStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-watch-'))
  dirs.push(dir)
  const path = join(dir, 'watch-state.json')
  return { store: new WatchMarkStore(() => path), path }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('WatchMarkStore', () => {
  it('keeps marks apart per account and ignores the address case', () => {
    const { store } = newStore()

    store.set('Member@Example.com', 'e1', true)
    store.set('other@example.com', 'e2', false)

    expect(store.marks('member@example.com')).toMatchObject({
      e1: { watched: true }
    })
    expect(store.marks('other@example.com')).toMatchObject({
      e2: { watched: false }
    })
    expect(store.marks(null)).toEqual({})
  })

  it('persists marks for the next launch', () => {
    const { store, path } = newStore()
    store.set('member@example.com', 'e1', false)

    const reopened = new WatchMarkStore(() => path)

    expect(reopened.marks('member@example.com')).toMatchObject({
      e1: { watched: false }
    })
  })

  it('persists the point a mark was made against', () => {
    const { store, path } = newStore()
    store.set('member@example.com', 'e1', true, { progress: 0.1, position: 300 })
    store.set('member@example.com', 'e2', false, { progress: 0.5, position: null })

    const reopened = new WatchMarkStore(() => path)

    expect(reopened.marks('member@example.com')).toMatchObject({
      e1: { watched: true, base: { progress: 0.1, position: 300 } },
      e2: { watched: false, base: { progress: 0.5, position: null } }
    })
  })

  it('ignores a base whose progress cannot be read', () => {
    const { store, path } = newStore()
    writeFileSync(
      path,
      JSON.stringify({
        'member@example.com': {
          good: { watched: true, at: 1, base: { progress: 0.2, position: 120 } },
          bad: { watched: true, at: 1, base: { progress: 'half' } }
        }
      })
    )

    expect(store.marks('member@example.com')).toEqual({
      good: { watched: true, at: 1, base: { progress: 0.2, position: 120 } },
      bad: { watched: true, at: 1 }
    })
  })

  it('counts launch retries, and a new mark starts over', () => {
    const { store, path } = newStore()
    store.set('member@example.com', 'e1', true)

    expect(store.retried('member@example.com', 'e1')).toBe(1)
    expect(store.retried('member@example.com', 'e1')).toBe(2)

    const reopened = new WatchMarkStore(() => path)
    expect(reopened.marks('member@example.com').e1).toMatchObject({ watched: true, sends: 2 })

    reopened.set('member@example.com', 'e1', true)
    expect(reopened.marks('member@example.com').e1).not.toHaveProperty('sends')
  })

  it('clears one episode without touching the rest', () => {
    const { store } = newStore()
    store.set('member@example.com', 'e1', true)
    store.set('member@example.com', 'e2', false)

    store.clear('member@example.com', 'e1')

    expect(store.marks('member@example.com')).toEqual({
      e2: expect.objectContaining({ watched: false })
    })
  })

  it('keeps marks in memory when there is nowhere to persist them', () => {
    const store = new WatchMarkStore(() => null)

    store.set('member@example.com', 'e1', true)
    expect(store.marks('member@example.com')).toMatchObject({ e1: { watched: true } })

    store.clear('member@example.com', 'e1')
    expect(store.marks('member@example.com')).toEqual({})
  })

  it('does not count a retry for a mark that is gone', () => {
    const { store } = newStore()
    store.set('member@example.com', 'e1', true)

    expect(store.retried('member@example.com', 'missing')).toBe(0)
    expect(store.retried('member@example.com', 'e1')).toBe(1)
    expect(store.retried('member@example.com', 'e1')).toBe(2)
  })

  it('starts empty when the file is damaged', () => {
    const { store, path } = newStore()
    writeFileSync(path, '{not json')

    expect(store.marks('member@example.com')).toEqual({})
  })

  it('drops malformed entries instead of failing to load', () => {
    const { store, path } = newStore()
    writeFileSync(
      path,
      JSON.stringify({
        'member@example.com': {
          good: { watched: true, at: 1 },
          bad: { watched: 'yes' },
          alsoBad: null
        }
      })
    )

    expect(store.marks('member@example.com')).toEqual({
      good: { watched: true, at: 1 }
    })
  })
})
