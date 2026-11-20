import { describe, expect, it } from 'vitest'
import * as Q from './queries'

const documents = Object.entries(Q).flatMap(([name, value]) =>
  typeof value === 'string' ? [[name, value] as [string, string]] : []
)

describe('query documents', () => {
  const cardUsers = {
    CONTENT: Q.CONTENT,
    SERIES: Q.SERIES,
    SEARCH: Q.SEARCH,
    CONTINUE_WATCHING: Q.CONTINUE_WATCHING
  }

  it.each(Object.entries(cardUsers))('%s defines the Card fragment it spreads', (_name, text) => {
    expect(text).toContain('...Card')
    expect(text).toContain('fragment Card on Content')
  })

  it('asks only for playable content types in feed queries', () => {
    expect(Q.PLAYABLE).toEqual(['video', 'videoPodcast', 'podcast'])
  })

  it.each(documents)('%s is a GraphQL operation', (_name, text) => {
    expect(text.trim()).toMatch(/^(query|mutation)\b/)
    expect(text.length).toBeGreaterThan(0)
  })

  it('sends progress tracking as a mutation', () => {
    expect(Q.TRACK.trim().startsWith('mutation')).toBe(true)
  })
})
