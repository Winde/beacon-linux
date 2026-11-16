import { describe, expect, it } from 'vitest'
import { chooseUpNext, type UpNextCandidate, type UpNextContext } from './upnext'

/** The Campaign 4 E3 -> E4 case: a trailer is filed at episode number 3. */
function context(overrides: Partial<UpNextContext> = {}): UpNextContext {
  return { collectionId: 'c4', isSeries: true, episodeNumber: 3, ...overrides }
}

function candidate(overrides: Partial<UpNextCandidate> = {}): UpNextCandidate {
  return {
    slug: 'c4-e004-stone-faced',
    title: 'C4 E004 | Stone-Faced',
    image: 'https://images.example/wide',
    minutes: 240,
    locked: false,
    episodeNumber: 4,
    collectionId: 'c4',
    ...overrides
  }
}

describe('chooseUpNext', () => {
  it('offers the next episode of the same series', () => {
    expect(chooseUpNext(context(), candidate())).toEqual({
      slug: 'c4-e004-stone-faced',
      title: 'C4 E004 | Stone-Faced',
      image: 'https://images.example/wide',
      minutes: 240
    })
  })

  it('offers the next part when the pointer numbers it one up', () => {
    // C3 E121 Part 1 is 121; the pointer reports Part 2 as 122.
    const part1 = context({ collectionId: 'c3', episodeNumber: 121 })
    const part2 = candidate({
      slug: 'c3-e121-a-new-age-begins-part-2',
      episodeNumber: 122,
      collectionId: 'c3'
    })

    expect(chooseUpNext(part1, part2)?.slug).toBe('c3-e121-a-new-age-begins-part-2')
  })

  it('crosses a campaign season boundary, because the numbering continues', () => {
    // Campaign 4 season 2 ends at E4 and season 3 starts at E5.
    expect(chooseUpNext(context({ episodeNumber: 4 }), candidate({ episodeNumber: 5 }))).not.toBeNull()
  })

  it('stops where the numbering restarts for another miniseries', () => {
    // Exandria Unlimited: Kymal E2 -> Calamity E1.
    const kymal = context({ collectionId: 'exu', episodeNumber: 2 })
    const calamity = candidate({
      slug: 'e1-exandria-unlimited-calamity',
      episodeNumber: 1,
      collectionId: 'exu'
    })

    expect(chooseUpNext(kymal, calamity)).toBeNull()
  })

  it('stops at the end of a season', () => {
    // Midst S1 finale is 20; season 2 restarts at 1.
    expect(chooseUpNext(context({ collectionId: 'midst', episodeNumber: 20 }), candidate({ episodeNumber: 1, collectionId: 'midst' }))).toBeNull()
  })

  it('stops when another show shares the episode number', () => {
    // Cooldown mixes nine shows and they all have an episode 1; the pointer
    // answers C4 E001 for a Shattered Legends cooldown.
    const shattered = context({ collectionId: 'cooldown', episodeNumber: 1 })
    const c4 = candidate({ slug: 'cr-cooldown-c4-e001', episodeNumber: 1, collectionId: 'cooldown' })

    expect(chooseUpNext(shattered, c4)).toBeNull()
  })

  it('still chains between cooldowns of the same show', () => {
    const e42 = context({ collectionId: 'cooldown', episodeNumber: 42 })
    const e43 = candidate({ slug: 'c4-e043-cooldown', episodeNumber: 43, collectionId: 'cooldown' })

    expect(chooseUpNext(e42, e43)).not.toBeNull()
  })

  it('never chains inside a non-series collection', () => {
    expect(
      chooseUpNext(
        context({ collectionId: 'one-shots', isSeries: false, episodeNumber: 1 }),
        candidate({ collectionId: 'one-shots', episodeNumber: 2 })
      )
    ).toBeNull()
  })

  it('needs a collection on both sides', () => {
    expect(chooseUpNext(context({ collectionId: null }), candidate())).toBeNull()
    expect(chooseUpNext(context(), candidate({ collectionId: 'c2' }))).toBeNull()
  })

  it('drops a locked candidate', () => {
    expect(chooseUpNext(context(), candidate({ locked: true }))).toBeNull()
  })

  it('drops a candidate with no episode number', () => {
    expect(chooseUpNext(context({ episodeNumber: null }), candidate())).toBeNull()
    expect(chooseUpNext(context(), candidate({ episodeNumber: null }))).toBeNull()
  })

  it('lets the video end when the pointer has no next item', () => {
    expect(chooseUpNext(context({ episodeNumber: 124 }), null)).toBeNull()
  })
})
