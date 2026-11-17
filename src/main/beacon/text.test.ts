import { describe, expect, it } from 'vitest'
import { displayTitle, episodeCode, imageUrl, normalize, relevance, type SearchDocument } from './text'

/** Build a search document the same way the catalog index does. */
function doc(title: string, series = ''): SearchDocument {
  return {
    norm: normalize(title),
    tokens: normalize(`${title} ${series}`).split(' ').filter(Boolean)
  }
}

describe('normalize', () => {
  it.each([
    ['Critical Role', 'critical role'],
    ['Café Déjà Vu', 'cafe deja vu'],
    ["The Mighty Nein's Story", 'the mighty neins story'],
    ['Vox Machina’s End', 'vox machinas end'],
    ['C4: E12 — Live!', 'c4 e12 live'],
    ['  spaced   out  ', 'spaced out'],
    ['', '']
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalize(input)).toBe(expected)
  })
})

describe('episodeCode', () => {
  it.each([
    ['c4e12', 'c4e12'],
    ['C4E12', 'c4e12'],
    ['C4 E012', 'c4e12'],
    ['c4e012 Wrap-Up', 'c4e12'],
    ['campaign 4 episode 12', 'c4e12'],
    ['Critical Role Campaign 3 Episode 100', 'c3e100'],
    ['campaign 04 ep 7', 'c4e7'],
    ['Campaign 2 EP 33', 'c2e33']
  ])('reads %j as %j', (input, expected) => {
    expect(episodeCode(input)).toBe(expected)
  })

  it.each([
    ['The Legend of Vox Machina'],
    ['episode 12'],
    ['campaign four episode twelve'],
    ['talks machina'],
    ['']
  ])('finds no code in %j', (input) => {
    expect(episodeCode(input)).toBeNull()
  })

  it('strips leading zeroes so the same episode has one code', () => {
    expect(episodeCode('C4 E0012')).toBe(episodeCode('c4e12'))
  })
})

describe('displayTitle', () => {
  it("prefers Beacon's short ottTitle", () => {
    expect(displayTitle({ title: 'C4 E043 | The Water’s Edge', ottTitle: 'The Water’s Edge' })).toBe(
      'The Water’s Edge'
    )
  })

  it('falls back to the full title when ottTitle is missing or blank', () => {
    expect(displayTitle({ title: 'C4 E043 | The Water’s Edge' })).toBe('C4 E043 | The Water’s Edge')
    expect(displayTitle({ title: 'C4 E043 | The Water’s Edge', ottTitle: null })).toBe(
      'C4 E043 | The Water’s Edge'
    )
    expect(displayTitle({ title: 'C4 E043 | The Water’s Edge', ottTitle: '  ' })).toBe(
      'C4 E043 | The Water’s Edge'
    )
  })

  it('trims and survives an empty record', () => {
    expect(displayTitle({ title: ' Title ', ottTitle: ' Short ' })).toBe('Short')
    expect(displayTitle({})).toBe('')
  })
})

describe('imageUrl', () => {
  const base = 'https://imagedelivery.net/abc/def/format=auto'

  it('returns null for a missing URL', () => {
    expect(imageUrl(null, 480)).toBeNull()
    expect(imageUrl(undefined, 480)).toBeNull()
    expect(imageUrl('', 480)).toBeNull()
  })

  it('appends the requested width to a resizable URL', () => {
    expect(imageUrl(base, 480)).toBe(`${base},width=480`)
  })

  it('replaces an existing width instead of stacking a second one', () => {
    const sized = `${base},width=960`
    expect(imageUrl(sized, 480)).toBe(`${base},width=480`)
    expect(imageUrl(sized, 1280)).not.toContain('width=960')
  })

  it('keeps the segments that follow the width', () => {
    expect(imageUrl(`${base},width=960,fit=cover`, 480)).toBe(`${base},width=480,fit=cover`)
  })

  it('leaves URLs that the CDN cannot resize untouched', () => {
    const fixed = 'https://example.com/thumb.jpg'
    expect(imageUrl(fixed, 480)).toBe(fixed)
  })
})

describe('relevance', () => {
  const campaign = doc('Critical Role Campaign 3', 'Critical Role')

  it('returns 0 for an empty query', () => {
    expect(relevance('', campaign)).toBe(0)
    expect(relevance('   ', campaign)).toBe(0)
  })

  it('scores an exact word match at 1', () => {
    expect(relevance('critical', campaign)).toBe(1)
    expect(relevance('CRITICAL', campaign)).toBe(1)
  })

  it('scores a prefix lower than an exact match', () => {
    const score = relevance('crit', campaign)
    expect(score).toBeCloseTo(0.895, 5)
    expect(score).toBeLessThan(relevance('critical', campaign))
  })

  it('finds a word inside a longer one', () => {
    // "ytime" is neither a prefix nor a whole word of "sleepytime".
    expect(relevance('ytime', doc('Sleepytime'))).toBeCloseTo(0.79, 5)
  })

  it('forgives a typo on longer queries', () => {
    expect(relevance('slepytime', doc('Sleepytime'))).toBeCloseTo(0.57, 5)
  })

  it('does not try to correct short queries', () => {
    expect(relevance('crit', doc('croft'))).toBe(0)
  })

  it('returns 0 when nothing matches', () => {
    expect(relevance('dragon', campaign)).toBe(0)
  })

  it('requires every word of a short query to match', () => {
    expect(relevance('critical dragon', campaign)).toBe(0)
  })

  it('tolerates one missing word in a long query', () => {
    expect(relevance('critical role campaign dragon', campaign)).toBeCloseTo(0.6375, 5)
  })

  it('rewards a whole-phrase match over scattered words', () => {
    const exact = relevance('campaign 3', doc('Campaign 3'))
    const scattered = relevance('campaign 3', doc('Campaign Diary 3'))
    expect(exact).toBe(1)
    expect(scattered).toBeCloseTo(0.85, 5)
  })

  it('saturates at 1 when the phrase and every token match', () => {
    // A longer title that still contains the query as a phrase scores the same
    // as an exact one. Which of the two is listed first is left to the catalog
    // order; giving exact titles a bonus would need the 0..1 scale to change.
    expect(relevance('campaign 3', doc('Campaign 3'))).toBe(1)
    expect(relevance('campaign 3', doc('Campaign 3 Preview'))).toBe(1)
  })
})
