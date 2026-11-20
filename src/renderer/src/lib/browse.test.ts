import { describe, expect, it } from 'vitest'
import type { Card } from '@shared/types'
import { sortBrowseCards } from './browse'

const card = (title: string, released: string | null): Card => ({
  kind: 'series',
  slug: title.toLowerCase().replace(/\s+/g, '-'),
  title,
  image: null,
  released
})

describe('sortBrowseCards', () => {
  const campaign = card('Campaign 4', '2025-09-18T00:00:00.000Z')
  const cooldown = card('Critical Role Cooldown', '2024-02-01T00:00:00.000Z')
  const bits = card('Beacon Bits!', '2024-11-06T00:00:00.000Z')
  const undated = card('Undated', null)

  it('sorts by the collection release date, newest first', () => {
    expect(
      sortBrowseCards([cooldown, undated, campaign, bits], 'newest').map((c) => c.title)
    ).toEqual(['Campaign 4', 'Beacon Bits!', 'Critical Role Cooldown', 'Undated'])
  })

  it('sorts oldest first and keeps missing dates last', () => {
    expect(
      sortBrowseCards([campaign, undated, bits, cooldown], 'oldest').map((c) => c.title)
    ).toEqual(['Critical Role Cooldown', 'Beacon Bits!', 'Campaign 4', 'Undated'])
  })

  it('sorts names both ways', () => {
    const names = [campaign, cooldown, bits, undated]
    expect(sortBrowseCards(names, 'alpha').map((c) => c.title)).toEqual([
      'Beacon Bits!',
      'Campaign 4',
      'Critical Role Cooldown',
      'Undated'
    ])
    expect(sortBrowseCards(names, 'reverse-alpha').map((c) => c.title)).toEqual([
      'Undated',
      'Critical Role Cooldown',
      'Campaign 4',
      'Beacon Bits!'
    ])
  })

  it('does not mutate the catalog order', () => {
    const input = [cooldown, campaign]
    sortBrowseCards(input, 'newest')
    expect(input.map((c) => c.title)).toEqual(['Critical Role Cooldown', 'Campaign 4'])
  })
})
