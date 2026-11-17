import { describe, expect, it } from 'vitest'
import { pageZoom } from './window-scale'

describe('pageZoom', () => {
  it('leaves the size the layout was drawn at alone', () => {
    expect(pageZoom(1280, 800)).toBe(1)
  })

  it('fills a 1080p television', () => {
    expect(pageZoom(1920, 1080)).toBeCloseTo(1.35)
  })

  it('fills a 4K television', () => {
    expect(pageZoom(3840, 2160)).toBeCloseTo(2.7)
  })

  it('shrinks into a small window rather than clipping it', () => {
    expect(pageZoom(960, 540)).toBeCloseTo(0.675)
  })

  it('keeps an ultrawide window from cropping the top and bottom', () => {
    expect(pageZoom(3440, 1440)).toBeCloseTo(1.8)
  })
})
