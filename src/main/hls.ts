import { net } from 'electron'
import { TtlCache } from './beacon/cache'

/** Hosts that serve Beacon's video and caption files. */
const MEDIA_HOSTS = /(^|\.)(jwplayer\.com|jwpsrv\.com|jwpcdn\.com|jwplatform\.com)$/

/** Master playlists change only when a stream is re-encoded. */
const playlists = new TtlCache<string, string>(5 * 60_000, 20)
/** A CDN that stops answering must not leave the player on its spinner. */
const MEDIA_TIMEOUT = 30_000

/** Test seam: the cache is module-level and outlives a single test. */
export function clearPlaylistCache(): void {
  playlists.clear()
}

export function isMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && MEDIA_HOSTS.test(url.hostname)
  } catch {
    return false
  }
}

/**
 * JW Player's master playlists list the 640x360 variant first, so a player that
 * takes the first stream starts blurry and only climbs after it has measured the
 * connection. Reorder the variants by bandwidth, highest first, and make every
 * URI absolute so the playlist can be served from anywhere.
 *
 * Returns null when the input is not a master playlist, so callers can fall back
 * to the original.
 */
export function reorderMasterPlaylist(text: string, base: string): string | null {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const head: string[] = []
  const variants: { lines: string[]; bandwidth: number; order: number }[] = []

  const absolute = (ref: string): string => {
    try {
      return new URL(ref, base).href
    } catch {
      return ref
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/URI="([^"]+)"/g, (_m, ref: string) => `URI="${absolute(ref)}"`)

    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      // A bare URI without its #EXT-X-STREAM-INF would change meaning if moved.
      if (line[0] !== '#') return null
      head.push(line)
      continue
    }

    const block = [line]
    while (++i < lines.length && lines[i][0] === '#') block.push(lines[i])
    if (i >= lines.length) return null
    block.push(absolute(lines[i]))

    const bandwidth = /(?:^|[:,])BANDWIDTH=(\d+)/.exec(line)
    variants.push({
      lines: block,
      bandwidth: bandwidth ? Number(bandwidth[1]) : 0,
      order: variants.length
    })
  }

  if (!variants.length) return null
  variants.sort((a, b) => b.bandwidth - a.bandwidth || a.order - b.order)

  return `${[...head, ...variants.flatMap((v) => v.lines)].join('\n')}\n`
}

/** Fetch a stream's master playlist, best variant first. Falls back to the original text. */
export async function fetchMasterPlaylist(url: string): Promise<string> {
  if (!isMediaUrl(url)) throw new Error('Stream host not allowed')
  // Replaying an episode should not wait on this request again.
  return playlists.load(url, async () => {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(MEDIA_TIMEOUT) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return reorderMasterPlaylist(text, url) ?? text
  })
}

/** Caption files come from JW Player without CORS headers, so the renderer can't fetch them. */
export async function fetchCaptionFile(url: string): Promise<string> {
  if (!isMediaUrl(url)) throw new Error('Caption host not allowed')
  const res = await net.fetch(url, { signal: AbortSignal.timeout(MEDIA_TIMEOUT) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
