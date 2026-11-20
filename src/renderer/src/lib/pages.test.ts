import { afterEach, describe, expect, it } from 'vitest'
import type { CollectionData, ContentData } from '@shared/types'
import { pageCache } from './pages'

afterEach(() => pageCache.clear())

function collection(slug: string): CollectionData {
  return {
    id: `id-${slug}`,
    slug,
    title: slug,
    image: null,
    image2x: null,
    isSeries: true,
    seasons: [{ title: 'Episodes', items: [] }]
  }
}

function content(slug: string): ContentData {
  return {
    id: `id-${slug}`,
    slug,
    title: slug,
    description: '',
    continuedSummary: '',
    image: null,
    image2x: null,
    minutes: null,
    released: null,
    kind: 'video',
    series: null,
    tier: null,
    locked: false,
    signInNeeded: false,
    signedIn: false,
    watched: false,
    resumeAt: 0,
    rows: []
  }
}

describe('pageCache', () => {
  it('seeds both kinds from the last launch', () => {
    pageCache.load({ collections: [collection('campaign-1')], contents: [content('c1e1')] })

    expect(pageCache.collection('campaign-1')?.title).toBe('campaign-1')
    expect(pageCache.content('c1e1')?.title).toBe('c1e1')
  })

  it('keeps the most recently used pages within the bound', () => {
    for (let index = 0; index < 61; index++) pageCache.rememberCollection(collection(`s${index}`))

    expect(pageCache.collection('s0')).toBeNull()
    expect(pageCache.collection('s1')).not.toBeNull()
  })

  it('refreshes the position of a page that is read again', () => {
    for (let index = 0; index < 60; index++) pageCache.rememberCollection(collection(`s${index}`))
    pageCache.collection('s0')

    pageCache.rememberCollection(collection('new'))

    expect(pageCache.collection('s0')).not.toBeNull()
    expect(pageCache.collection('s1')).toBeNull()
  })

  it('forgets a page the CMS no longer has', () => {
    pageCache.rememberCollection(collection('campaign-1'))
    pageCache.rememberContent(content('c1e1'))

    pageCache.forgetCollection('campaign-1')
    pageCache.forgetContent('c1e1')

    expect(pageCache.collection('campaign-1')).toBeNull()
    expect(pageCache.content('c1e1')).toBeNull()
  })

  it('clears both kinds when the account changes', () => {
    pageCache.load({ collections: [collection('campaign-1')], contents: [content('c1e1')] })

    pageCache.clear()

    expect(pageCache.collection('campaign-1')).toBeNull()
    expect(pageCache.content('c1e1')).toBeNull()
  })
})
