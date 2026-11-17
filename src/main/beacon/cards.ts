import type { Card, CaptionTrack, WatchState } from '@shared/types'
import type { IndexedVideo } from './catalog-types'
import type { CmsCard, CmsCollection } from './cms-types'
import { displayTitle, imageUrl as img } from './text'

export const minutes = (ms?: number | null): number | null =>
  ms ? Math.max(1, Math.round(ms / 60000)) : null

export function captionsOf(video: { videoData?: string; closedCaptions?: string }): CaptionTrack[] {
  const out: CaptionTrack[] = []
  try {
    const data = JSON.parse(video.videoData || '{}') as {
      playlist?: { tracks?: { kind?: string; label?: string; file?: string }[] }[]
    }
    for (const track of data.playlist?.[0]?.tracks ?? []) {
      if ((track.kind === 'captions' || track.kind === 'subtitles') && track.file) {
        out.push({ label: track.label || 'Subtitles', url: track.file })
      }
    }
  } catch {
    // no playlist data
  }
  if (
    !out.length &&
    typeof video.closedCaptions === 'string' &&
    /^https?:/.test(video.closedCaptions)
  ) {
    out.push({ label: 'Subtitles', url: video.closedCaptions })
  }
  return out
}

/**
 * Whether a video is in its closing stretch: past `share` percent and, when
 * the runtime is known, with no more than `tail` seconds left.
 */
export function closingStretch(
  progress: number,
  position: number | null | undefined,
  runtimeSec: number | null | undefined,
  share: number,
  tail: number
): boolean {
  if (progress < share) return false
  // Without a runtime there is no tail to measure; keep the plain share rule.
  if (!runtimeSec) return true
  const left =
    position != null && position >= 0 && position <= runtimeSec
      ? runtimeSec - position
      : (runtimeSec * (100 - progress)) / 100
  return left <= tail
}

export function videoCard(c: CmsCard, level: number, state?: WatchState): Card {
  return {
    kind: 'video',
    id: c.id,
    slug: c.slug,
    title: displayTitle(c),
    subtitle: c.primaryCollection?.name ?? '',
    image: img(c.thumbnail?.sizes?.landscape?.url, 480),
    image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
    minutes: minutes(c.duration),
    locked: (c.contentTier?.planLevel ?? 0) > level,
    progress: state?.progress ?? 0,
    watched: state?.watched ?? false
  }
}

export function indexedVideoCard(v: IndexedVideo, level: number, state?: WatchState): Card {
  return {
    kind: 'video',
    id: v.id,
    slug: v.slug,
    title: displayTitle(v),
    subtitle: v.series?.name ?? '',
    image: img(v.image, 480),
    image2x: img(v.image2x, 480),
    minutes: minutes(v.duration),
    locked: v.level > level,
    progress: state?.progress ?? 0,
    watched: state?.watched ?? false
  }
}

export function seriesCard(c: CmsCollection): Card {
  return {
    kind: 'series',
    id: c.id,
    slug: c.slug,
    title: c.name,
    image: img(c.thumbnail?.sizes?.landscape?.url ?? c.thumbnail?.sizes?.portrait?.url, 480),
    image2x: img(c.thumbnail?.sizes?.landscape2x?.url, 480),
    count: c.itemCount ?? null
  }
}

/** The hero asks for its own image size; a tile's is too soft full-bleed. */
export function heroSized(card: Card): Card {
  return {
    ...card,
    image: img(card.image, 1280),
    image2x: img(card.image2x, 1280)
  }
}
