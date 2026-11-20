import { describe, expect, it } from 'vitest'
import type { IndexedCollection, IndexedVideo } from './catalog-types'
import type { CmsCard, CmsCollection } from './cms-types'
import {
  captionsOf,
  closingStretch,
  heroSized,
  indexedCollectionCard,
  indexedVideoCard,
  minutes,
  seriesCard,
  videoCard
} from './cards'

const card: CmsCard = {
  id: 'v1',
  slug: 'c4e1',
  title: "C4 E001 | The Water's Edge",
  ottTitle: "The Water's Edge",
  duration: 3_600_000,
  contentType: 'video',
  episodeNumber: 1,
  releaseDate: '2026-01-02T00:00:00.000Z',
  contentTier: { name: 'Member', planLevel: 2 },
  primaryCollection: { id: 'c4', name: 'Campaign 4', slug: 'campaign-4', isSeries: true },
  thumbnail: {
    sizes: {
      landscape: { url: 'https://images.example/landscape/format=auto' },
      landscape2x: { url: 'https://images.example/landscape2x/format=auto' }
    }
  }
}

const collection: CmsCollection = {
  id: 'c4',
  name: 'Campaign 4',
  slug: 'campaign-4',
  isSeries: true,
  itemCount: 42,
  thumbnail: {
    sizes: {
      portrait: { url: 'https://images.example/portrait/format=auto' },
      landscape2x: { url: 'https://images.example/landscape2x/format=auto' }
    }
  }
}

function indexed(overrides: Partial<IndexedVideo> = {}): IndexedVideo {
  return {
    id: 'v1',
    slug: 'c4e1',
    title: "C4 E001 | The Water's Edge",
    ottTitle: "The Water's Edge",
    duration: 3_600_000,
    type: 'video',
    tier: 'Member',
    level: 2,
    image: 'https://images.example/landscape/format=auto',
    image2x: null,
    released: null,
    episode: 1,
    series: { id: 'c4', name: 'Campaign 4', slug: 'campaign-4', isSeries: true },
    ...overrides
  }
}

describe('card mapping', () => {
  it('rounds a runtime to whole minutes and leaves a missing one null', () => {
    expect(minutes(3_600_000)).toBe(60)
    expect(minutes(30_000)).toBe(1)
    expect(minutes(null)).toBeNull()
    expect(minutes(0)).toBeNull()
  })

  it('maps a CMS card to a tile, preferring the short title', () => {
    expect(videoCard(card, 2)).toMatchObject({
      kind: 'video',
      id: 'v1',
      slug: 'c4e1',
      title: "The Water's Edge",
      subtitle: 'Campaign 4',
      image: 'https://images.example/landscape/format=auto,width=480',
      image2x: 'https://images.example/landscape2x/format=auto,width=480',
      minutes: 60,
      locked: false
    })
  })

  it('locks a card above the account tier and carries watch state', () => {
    expect(videoCard(card, 1, { progress: 0.4, watched: false })).toMatchObject({
      locked: true,
      progress: 0.4,
      watched: false
    })
  })

  it('maps an indexed video with the same rules', () => {
    expect(indexedVideoCard(indexed(), 2, { progress: 0.5, watched: true })).toMatchObject({
      title: "The Water's Edge",
      subtitle: 'Campaign 4',
      minutes: 60,
      locked: false,
      progress: 0.5,
      watched: true
    })
  })

  it('falls back to portrait art for a series without a landscape', () => {
    expect(seriesCard(collection)).toMatchObject({
      kind: 'series',
      image: 'https://images.example/portrait/format=auto,width=480',
      image2x: 'https://images.example/landscape2x/format=auto,width=480',
      count: 42
    })
  })

  it('maps an indexed collection for the browse grid', () => {
    const indexedCollection: IndexedCollection = {
      id: 'p1',
      slug: 'previously-on',
      name: 'Previously On...',
      isSeries: false,
      itemCount: 5,
      released: null,
      image: null,
      image2x: null,
      portrait: 'https://images.example/portrait/format=auto'
    }
    expect(indexedCollectionCard(indexedCollection)).toEqual({
      kind: 'series',
      id: 'p1',
      slug: 'previously-on',
      title: 'Previously On...',
      image: 'https://images.example/portrait/format=auto,width=480',
      image2x: null,
      count: 5,
      released: null
    })
  })

  it('asks for hero-sized art without changing the rest of the card', () => {
    const tile = indexedVideoCard(indexed(), 2)
    expect(heroSized(tile)).toMatchObject({
      ...tile,
      image: 'https://images.example/landscape/format=auto,width=1280'
    })
  })
})

describe('captionsOf', () => {
  it('reads caption and subtitle tracks from the playlist data', () => {
    const data = JSON.stringify({
      playlist: [
        {
          tracks: [
            { kind: 'captions', label: 'English', file: 'https://cdn.example/en.vtt' },
            { kind: 'subtitles', label: 'Deutsch', file: 'https://cdn.example/de.vtt' },
            { kind: 'thumbnails', file: 'https://cdn.example/thumbs.vtt' },
            { kind: 'captions', file: 'https://cdn.example/unnamed.vtt' }
          ]
        }
      ]
    })
    expect(captionsOf({ videoData: data })).toEqual([
      { label: 'English', url: 'https://cdn.example/en.vtt' },
      { label: 'Deutsch', url: 'https://cdn.example/de.vtt' },
      { label: 'Subtitles', url: 'https://cdn.example/unnamed.vtt' }
    ])
  })

  it('falls back to a closed-captions URL when the playlist has none', () => {
    expect(captionsOf({ closedCaptions: 'https://cdn.example/en.vtt' })).toEqual([
      { label: 'Subtitles', url: 'https://cdn.example/en.vtt' }
    ])
  })

  it('ignores malformed data and non-URL captions', () => {
    expect(captionsOf({ videoData: 'not json', closedCaptions: 'captions/en.vtt' })).toEqual([])
  })
})

describe('closingStretch', () => {
  it('requires both the share and the tail when the runtime is known', () => {
    expect(closingStretch(92, 5_800, 6_000, 92, 300)).toBe(true)
    expect(closingStretch(92, 4_800, 6_000, 92, 300)).toBe(false)
    expect(closingStretch(91, 5_990, 6_000, 92, 300)).toBe(false)
  })

  it('keeps the plain share rule without a runtime', () => {
    expect(closingStretch(93, null, null, 92, 300)).toBe(true)
    expect(closingStretch(91, null, 0, 92, 300)).toBe(false)
  })

  it('estimates the remaining time when only a percentage is known', () => {
    expect(closingStretch(97, null, 6_000, 92, 300)).toBe(true)
    expect(closingStretch(92, null, 6_000, 92, 300)).toBe(false)
  })
})
