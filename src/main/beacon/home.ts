import type { Card, HomeData, HomeRow, WatchState } from '@shared/types'
import type { CatalogLike } from './client'
import type {
  BlockCollection,
  BlockContent,
  CmsCard,
  ContinueWatchingResult,
  HomeBlock
} from './cms-types'
import { heroSized, seriesCard, videoCard } from './cards'
import { PLATFORM, VIDEO_TYPES } from './platform'
import * as Q from './queries'
import type { WatchMark } from './watchmarks'

export interface HomeDependencies {
  gql<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  isSignedIn(): Promise<boolean>
  userLevel(): Promise<number>
  catalog: CatalogLike | null
  watchMarks(): Promise<{ email: string | null; marks: Record<string, WatchMark> }>
  watchState(
    id: string,
    durationMs: number | null | undefined,
    progress: number,
    position: number | null | undefined,
    email: string | null,
    marks: Record<string, WatchMark>
  ): WatchState
}

/** Blocks excluded for the platform we identify as are not rendered at all. */
function blockVisible(block: HomeBlock): boolean {
  return !block.excludedPlatforms?.[PLATFORM]
}

function blockCards(values: (BlockContent | BlockCollection)[] | undefined, level: number): Card[] {
  return (values ?? [])
    .map((value) => blockCard(value, level))
    .filter((card): card is Card => card !== null)
}

/** A block item, or null when it is a kind this TV client cannot open. */
function blockCard(value: BlockContent | BlockCollection, level: number): Card | null {
  if ('name' in value) return seriesCard(value)
  return VIDEO_TYPES.has(value.contentType ?? '') ? videoCard(value as CmsCard, level) : null
}

async function continueWatchingRow(
  deps: HomeDependencies,
  cw: ContinueWatchingResult,
  level: number,
  limit: number,
  blockId?: string
): Promise<HomeRow | null> {
  const candidates = (cw.continueWatching?.docs ?? []).filter((doc) => doc.content)
  if (!candidates.length) return null

  const { email, marks } = await deps.watchMarks()
  const states = new Map(
    candidates.map((doc) => {
      const content = doc.content!
      return [
        content.id,
        deps.watchState(
          content.id,
          content.duration,
          Math.min(1, (doc.videoProgress ?? 0) / 100),
          doc.videoProgressSeconds,
          email,
          marks
        )
      ] as const
    })
  )
  // A cleared episode sits at one second, which Beacon may still list as
  // started. Neither a mark nor that residue belongs in this row.
  const unfinished = candidates.filter((doc) => {
    const state = states.get(doc.content!.id)!
    return !state.watched && state.progress > 0.01
  })
  if (!unfinished.length) return null

  // The limit applies to what this row shows, not to what Beacon listed:
  // finished entries must not use up the block's slots.
  const watching = unfinished.slice(0, limit)

  return {
    id: blockId ?? 'continue',
    kind: 'continue',
    title: 'Continue watching',
    items: watching.map((doc) => videoCard(doc.content!, level, states.get(doc.content!.id)))
  }
}

/**
 * The member home as Beacon's editors arrange it. Only blocks this client can
 * render are described; an unknown block arrives with a __typename and no
 * fields, so it is skipped without taking the page down.
 */
export async function buildHome(deps: HomeDependencies): Promise<HomeData> {
  const signed = await deps.isSignedIn()
  const level = await deps.userLevel()
  deps.catalog?.ensure().catch(() => {})

  const [page, cw] = await Promise.all([
    deps.gql<{ MemberHomePage?: { pageContent?: HomeBlock[] } }>(Q.HOME_BLOCKS),
    signed
      ? deps.gql<ContinueWatchingResult>(Q.CONTINUE_WATCHING, { limit: 50 }).catch(() => null)
      : Promise.resolve(null)
  ])

  const rows: HomeRow[] = []
  let hero: Card[] = []

  for (const block of page.MemberHomePage?.pageContent ?? []) {
    if (!blockVisible(block)) continue

    switch (block.__typename) {
      case 'RedesignHeroCarousel':
        hero = (block.items ?? [])
          .map((entry) => entry.item?.value)
          .filter((value): value is BlockContent | BlockCollection => Boolean(value))
          .map((value) => blockCard(value, level))
          .filter((card): card is Card => card !== null)
          .map((card) => heroSized(card))
          .slice(0, 8)
        break

      case 'ContinueWatchingV2': {
        if (!cw) break
        const limit = Math.max(1, Math.min(50, block.limit ?? 20))
        const row = await continueWatchingRow(deps, cw, level, limit, block.id)
        if (row) rows.push(row)
        break
      }

      case 'FeaturedCarousel':
      case 'LatestCarousel': {
        const kind = block.__typename === 'FeaturedCarousel' ? 'featured' : 'latest'
        const items = blockCards(block.content, level)
        if (items.length) {
          rows.push({
            id: block.id ?? kind,
            kind,
            title: block.title || (kind === 'featured' ? 'Featured' : 'Latest'),
            items
          })
        }
        break
      }

      case 'SeriesCarousel': {
        const items = (block.content ?? [])
          .filter((value): value is BlockCollection => 'name' in value)
          .map((value) => seriesCard(value))
        if (items.length) {
          rows.push({
            id: block.id ?? 'series',
            kind: 'series',
            title: block.title || 'Series',
            items
          })
        }
        break
      }

      case 'ListenCarousel': {
        const items = blockCards(block.content, level)
        if (items.length) {
          rows.push({
            id: block.id ?? 'listen',
            kind: 'listen',
            title: block.title || 'Listen',
            items
          })
        }
        break
      }
    }
  }

  // A hero block can be missing or hold only kinds we cannot open; the first
  // video shelf is a serviceable stand-in.
  if (!hero.length) {
    const source =
      rows.find((row) => row.kind === 'featured') ?? rows.find((row) => row.kind === 'latest')
    hero = (source?.items ?? [])
      .filter((card) => card.kind === 'video')
      .slice(0, 5)
      .map((card) => heroSized(card))
  }

  return { hero, rows: rows.filter((row) => row.items.length) }
}
