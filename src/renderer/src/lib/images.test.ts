import { describe, expect, it } from 'vitest'
import { imageUrl } from '../../../main/beacon/text'
import { HERO_WIDTH, atWidth, backdropUrl } from './images'

const RESIZABLE = 'https://imagedelivery.net/abc/def/format=auto'

/** Real URLs end in `format=auto`; the rendition name sits before it. */
const rendition = (name: string): string => `https://imagedelivery.net/abc/def/${name}/format=auto`

describe('atWidth', () => {
  it('returns null for a missing URL', () => {
    expect(atWidth(null, 480)).toBeNull()
  })

  it('appends the requested width', () => {
    expect(atWidth(RESIZABLE, 480)).toBe(`${RESIZABLE},width=480`)
  })

  it('replaces an existing width', () => {
    expect(atWidth(`${RESIZABLE},width=960`, 480)).toBe(`${RESIZABLE},width=480`)
  })

  it('keeps the segments after the width', () => {
    expect(atWidth(`${RESIZABLE},width=960,fit=cover`, 480)).toBe(`${RESIZABLE},width=480,fit=cover`)
  })

  it('leaves URLs that cannot be resized alone', () => {
    expect(atWidth('https://example.com/thumb.jpg', 480)).toBe('https://example.com/thumb.jpg')
  })
})

describe('the renderer helper mirrors the main-process one', () => {
  const urls = [
    null,
    '',
    RESIZABLE,
    `${RESIZABLE},width=960`,
    `${RESIZABLE},width=960,fit=cover`,
    'https://example.com/thumb.jpg'
  ]

  it.each(urls)('agrees on %j', (url) => {
    expect(atWidth(url, 480)).toBe(imageUrl(url, 480))
  })
})

describe('backdropUrl', () => {
  it('prefers the 2x rendition, rewritten to the hero width', () => {
    expect(backdropUrl(rendition('landscape'), rendition('landscape2x'))).toBe(
      `${rendition('landscape2x')},width=${HERO_WIDTH}`
    )
  })

  it('falls back to the landscape rendition', () => {
    expect(backdropUrl(rendition('landscape'), null)).toBe(
      `${rendition('landscape')},width=${HERO_WIDTH}`
    )
    expect(backdropUrl(rendition('landscape'), undefined)).toBe(
      `${rendition('landscape')},width=${HERO_WIDTH}`
    )
  })

  it('honours an explicit width', () => {
    expect(backdropUrl(rendition('landscape'), null, 1920)).toBe(
      `${rendition('landscape')},width=1920`
    )
  })

  it('returns null when there is no artwork', () => {
    expect(backdropUrl(null, null)).toBeNull()
  })
})
