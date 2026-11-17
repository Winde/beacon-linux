import { describe, expect, it } from 'vitest'
import type { Card, FavouriteItem } from './types'
import { isFavourite, optimisticItem, toCard } from './favourites'

const item: FavouriteItem = {
  kind: 'series',
  id: 'c1',
  slug: 'campaign-1',
  title: 'Campaign 1',
  image: 'https://images.example/landscape/format=auto',
  image2x: 'https://images.example/landscape2x/format=auto',
  count: 42
}

const series: Card = {
  kind: 'series',
  id: 'c1',
  slug: 'campaign-1',
  title: 'Campaign 1',
  image: null,
  image2x: undefined,
  count: 42
}

describe('favourites model', () => {
  it('draws a favourite with the ordinary series tile', () => {
    expect(toCard(item)).toEqual({
      kind: 'series',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: item.image,
      image2x: item.image2x,
      count: 42
    })
  })

  it('turns a missing count into undefined, which the tile omits', () => {
    expect(toCard({ ...item, count: null }).count).toBeUndefined()
  })

  it('matches a favourite by slug', () => {
    expect(isFavourite([item], 'campaign-1')).toBe(true)
    expect(isFavourite([item], 'campaign-2')).toBe(false)
    expect(isFavourite([], 'campaign-1')).toBe(false)
  })

  it('makes an optimistic row item from a series card', () => {
    expect(optimisticItem(series)).toEqual({
      kind: 'series',
      id: 'c1',
      slug: 'campaign-1',
      title: 'Campaign 1',
      image: null,
      image2x: null,
      count: 42
    })
  })

  it('does not make a row item from a video', () => {
    expect(optimisticItem({ ...series, kind: 'video' })).toBeNull()
  })

  it('keeps an id-less card usable until the account answers', () => {
    expect(optimisticItem({ ...series, id: undefined })).toMatchObject({ id: '' })
  })
})
