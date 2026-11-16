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

  it('clears one episode without touching the rest', () => {
    const { store } = newStore()
    store.set('member@example.com', 'e1', true)
    store.set('member@example.com', 'e2', false)

    store.clear('member@example.com', 'e1')

    expect(store.marks('member@example.com')).toEqual({
      e2: expect.objectContaining({ watched: false })
    })
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
