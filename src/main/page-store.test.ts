import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionData, ContentData } from '@shared/types'
import { PageStore } from './page-store'

const MAX_PAGE_BYTES = 2 * 1024 * 1024

let directory: string

function collection(slug: string, title = slug): CollectionData {
  return {
    id: `id-${slug}`,
    slug,
    title,
    image: null,
    image2x: null,
    isSeries: true,
    seasons: [
      {
        title: 'Episodes',
        items: [{ kind: 'video', slug: `${slug}-e1`, title: 'Episode 1', image: null }]
      }
    ]
  }
}

function content(slug: string, description = ''): ContentData {
  return {
    id: `id-${slug}`,
    slug,
    title: slug,
    description,
    continuedSummary: '',
    image: null,
    image2x: null,
    minutes: 55,
    released: null,
    kind: 'video',
    livestream: false,
    live: false,
    series: { slug: 'campaign-1', title: 'Campaign 1', isSeries: true },
    tier: 'Apprentice',
    locked: false,
    signInNeeded: false,
    signedIn: true,
    watched: false,
    resumeAt: 0,
    rows: []
  }
}

function filePath(): string {
  return join(directory, 'page-cache.json')
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'beacon-page-store-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

describe('PageStore', () => {
  it('round-trips collection and episode pages for its account', () => {
    const store = new PageStore(() => directory)
    store.saveCollection('member@example.com', collection('campaign-1', 'Campaign 1'))
    store.saveContent('member@example.com', content('c1e1'))

    const pages = store.readAll('member@example.com')

    expect(pages.collections[0]?.title).toBe('Campaign 1')
    expect(pages.contents[0]?.slug).toBe('c1e1')
  })

  it('keeps one kind when the other is written later', () => {
    const store = new PageStore(() => directory)
    store.saveCollection('member@example.com', collection('campaign-1'))
    store.saveContent('member@example.com', content('c1e1'))

    const pages = new PageStore(() => directory).readAll('member@example.com')

    expect(pages.collections).toHaveLength(1)
    expect(pages.contents).toHaveLength(1)
  })

  it('deletes a slot belonging to another account on sight', () => {
    const store = new PageStore(() => directory)
    store.saveCollection('other@example.com', collection('campaign-1'))

    expect(store.readAll('member@example.com').collections).toEqual([])
    expect(existsSync(filePath())).toBe(false)
  })

  it('drops a file from an older schema', () => {
    writeFileSync(
      filePath(),
      JSON.stringify({ version: 0, scope: 'member@example.com', collections: {}, contents: {} })
    )

    const store = new PageStore(() => directory)

    expect(store.readAll('member@example.com').collections).toEqual([])
    expect(existsSync(filePath())).toBe(false)
  })

  it('drops a damaged file instead of painting half a page', () => {
    writeFileSync(filePath(), '{"version":1,"scope":"member@example.com","collections":')

    const store = new PageStore(() => directory)

    expect(store.readAll('member@example.com').collections).toEqual([])
    expect(existsSync(filePath())).toBe(false)
  })

  it('drops a file larger than the budget before parsing it', () => {
    writeFileSync(filePath(), 'x'.repeat(MAX_PAGE_BYTES + 1))

    const store = new PageStore(() => directory)

    expect(store.readAll('member@example.com').collections).toEqual([])
    expect(existsSync(filePath())).toBe(false)
  })

  it('evicts the oldest entries when a kind grows past its count guard', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new PageStore(() => directory)

    for (let index = 0; index < 61; index++) {
      store.saveCollection('member@example.com', collection(`s${index}`))
      vi.advanceTimersByTime(1)
    }

    const pages = store.readAll('member@example.com')

    expect(pages.collections).toHaveLength(60)
    expect(pages.collections.some((page) => page.slug === 's0')).toBe(false)
    expect(pages.collections.some((page) => page.slug === 's60')).toBe(true)
  })

  it('evicts the least recently used page when the file passes its byte budget', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new PageStore(() => directory)
    const description = 'x'.repeat(200_000)

    for (let index = 0; index < 12; index++) {
      store.saveContent('member@example.com', content(`e${index}`, description))
      vi.advanceTimersByTime(1)
    }

    const raw = readFileSync(filePath(), 'utf8')
    const pages = store.readAll('member@example.com')

    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_PAGE_BYTES)
    expect(pages.contents.some((page) => page.slug === 'e0')).toBe(false)
    expect(pages.contents.some((page) => page.slug === 'e11')).toBe(true)
  })

  it('removes a page the CMS says no longer exists', () => {
    const store = new PageStore(() => directory)
    store.saveCollection('member@example.com', collection('campaign-1'))
    store.saveContent('member@example.com', content('c1e1'))

    store.deleteCollection('member@example.com', 'campaign-1')
    store.deleteContent('member@example.com', 'c1e1')

    const pages = store.readAll('member@example.com')
    expect(pages.collections).toEqual([])
    expect(pages.contents).toEqual([])
  })

  it('clears the file on sign-out', () => {
    const store = new PageStore(() => directory)
    store.saveCollection('member@example.com', collection('campaign-1'))

    store.clear()

    expect(store.readAll('member@example.com').collections).toEqual([])
    expect(existsSync(filePath())).toBe(false)
  })
})
