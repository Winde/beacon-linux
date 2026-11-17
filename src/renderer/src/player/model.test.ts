import { describe, expect, it } from 'vitest'
import { formatTime, levelLabel, speedLabel, type QualityLevel } from './model'

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [61, '1:01'],
    [599, '9:59'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [36000, '10:00:00']
  ])('formats %i seconds as %s', (seconds, label) => {
    expect(formatTime(seconds)).toBe(label)
  })

  it('floors a fractional position rather than rounding it up', () => {
    expect(formatTime(59.9)).toBe('0:59')
  })

  it('does not show a negative or unreadable clock', () => {
    expect(formatTime(-1)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('levelLabel', () => {
  const level = (overrides: Partial<QualityLevel> = {}): QualityLevel => ({
    index: 0,
    height: null,
    bitrate: 0,
    ...overrides
  })

  it('calls the automatic choice Auto', () => {
    expect(levelLabel(undefined)).toBe('Auto')
  })

  it('names a rendition by its height when the stream reports one', () => {
    expect(levelLabel(level({ height: 1080, bitrate: 5_000_000 }))).toBe('1080p')
  })

  it('falls back to the bitrate when the height is unknown', () => {
    expect(levelLabel(level({ bitrate: 800_000 }))).toBe('800 kbps')
    expect(levelLabel(level({ bitrate: 2_450_000 }))).toBe('2450 kbps')
  })

  it('keeps a generic label when neither number is known', () => {
    expect(levelLabel(level())).toBe('Level')
  })
})

describe('speedLabel', () => {
  it.each([
    [0.75, '0.75×'],
    [1, '1×'],
    [1.25, '1.25×'],
    [1.5, '1.5×'],
    [2, '2×']
  ])('shows %s as %s', (speed, label) => {
    expect(speedLabel(speed)).toBe(label)
  })
})
