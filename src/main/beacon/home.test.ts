import { describe, expect, it } from 'vitest'
import type { WatchState } from '@shared/types'
import type { CmsCard, ContinueWatchingDoc, HomeBlock } from './cms-types'
import type { HomeDependencies } from './home'
import { buildHome } from './home'
import * as Q from './queries'

function cmsCard(overrides: Partial<CmsCard> = {}): CmsCard {
  return {
    id: 'cw1',
    title: 'Campaign 1 Episode 1',
    slug: 'cw1',
    duration: 3_300_000,
    contentType: 'video',
    contentTier: { name: 'Apprentice', planLevel: 1 },
    ...overrides
  }
}

function doc(id: string, progress: number): ContinueWatchingDoc {
  return {
    videoProgress: progress,
    content: cmsCard({ id, slug: id, title: id })
  }
}

function continueBlock(limit: number, id = 'cw-block'): HomeBlock {
  return { __typename: 'ContinueWatchingV2', id, limit }
}

/** Builds deps with a fixed home document and Continue watching read. */
function depsFor(
  pageContent: HomeBlock[],
  docs: ContinueWatchingDoc[],
  watchState?: HomeDependencies['watchState']
): HomeDependencies {
  return {
    gql: async <T>(query: string): Promise<T> => {
      if (query === Q.HOME_BLOCKS) return { MemberHomePage: { pageContent } } as T
      if (query === Q.CONTINUE_WATCHING) return { continueWatching: { docs } } as T
      throw new Error(`unrouted query: ${query.slice(0, 40)}`)
    },
    isSignedIn: async () => true,
    userLevel: async () => 2,
    catalog: null,
    watchMarks: async () => ({ email: 'member@example.com', marks: {} }),
    watchState:
      watchState ??
      ((_id, _duration, progress): WatchState => ({
        progress,
        watched: progress * 100 >= 92
      }))
  }
}

describe('buildHome', () => {
  it('applies the Continue watching limit after finished entries are removed', async () => {
    const docs = [
      doc('finished-1', 99),
      doc('finished-2', 95),
      doc('unfinished-1', 40),
      doc('unfinished-2', 30),
      doc('unfinished-3', 20)
    ]
    const home = await buildHome(depsFor([continueBlock(3)], docs))

    expect(home.rows).toHaveLength(1)
    expect(home.rows[0]).toMatchObject({ id: 'cw-block', kind: 'continue' })
    expect(home.rows[0].items.map((item) => item.id)).toEqual([
      'unfinished-1',
      'unfinished-2',
      'unfinished-3'
    ])
  })

  it('keeps only the limit when more unfinished entries exist than slots', async () => {
    const docs = Array.from({ length: 8 }, (_, index) => doc(`cw${index}`, 40))
    const home = await buildHome(depsFor([continueBlock(3)], docs))

    expect(home.rows[0].items.map((item) => item.id)).toEqual(['cw0', 'cw1', 'cw2'])
  })

  it('drops entries with no content before counting them against the limit', async () => {
    const docs: ContinueWatchingDoc[] = [{ videoProgress: 40 }, doc('first', 40), doc('second', 30)]
    const home = await buildHome(depsFor([continueBlock(2)], docs))

    expect(home.rows[0].items.map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('leaves the row out when every entry is finished or cleared', async () => {
    const docs = [doc('finished', 99), doc('cleared', 0)]
    const home = await buildHome(depsFor([continueBlock(3)], docs))

    expect(home.rows).toEqual([])
  })

  it('renders the Listen carousel with podcast cards', async () => {
    const home = await buildHome(
      depsFor(
        [
          {
            __typename: 'ListenCarousel',
            id: 'listen-block',
            title: 'Listen up',
            content: [
              cmsCard({
                id: 'p1',
                slug: 'a-podcast',
                title: 'A Podcast',
                contentType: 'podcast'
              })
            ]
          }
        ],
        []
      )
    )

    expect(home.rows).toHaveLength(1)
    expect(home.rows[0]).toMatchObject({ id: 'listen-block', kind: 'listen', title: 'Listen up' })
    expect(home.rows[0].items[0]).toMatchObject({ id: 'p1', title: 'A Podcast' })
  })

  it('leaves the row out when a local mark hides the only entry', async () => {
    const docs = [doc('marked', 40)]
    const watchState: HomeDependencies['watchState'] = () => ({ progress: 1, watched: true })
    const home = await buildHome(depsFor([continueBlock(3)], docs, watchState))

    expect(home.rows).toEqual([])
  })
})
