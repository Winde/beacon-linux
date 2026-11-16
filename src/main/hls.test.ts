import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlaylistCache,
  fetchCaptionFile,
  fetchMasterPlaylist,
  isMediaUrl,
  reorderMasterPlaylist
} from './hls'

// hls.ts imports Electron's net at module load; these tests only need the pure helpers.
const net = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: net.fetch } }))

beforeEach(() => {
  net.fetch.mockReset()
  clearPlaylistCache()
})

const BASE = 'https://cdn.jwplayer.com/v2/media/abc123/master.m3u8'

function variantLine(bandwidth: number | null, resolution = '1280x720'): string {
  return `#EXT-X-STREAM-INF:${bandwidth === null ? '' : `BANDWIDTH=${bandwidth},`}RESOLUTION=${resolution}`
}

describe('isMediaUrl', () => {
  it.each([
    'https://cdn.jwplayer.com/manifests/abc.m3u8',
    'https://content.jwplatform.com/videos/abc.mp4',
    'https://edge.jwpsrv.com/stream.m3u8',
    'https://jwplayer.com/file'
  ])('allows %j', (url) => {
    expect(isMediaUrl(url)).toBe(true)
  })

  it.each([
    'http://cdn.jwplayer.com/manifests/abc.m3u8',
    'https://cdn.jwplayer.com.evil.test/abc.m3u8',
    'https://eviljwplayer.com/abc.m3u8',
    'https://example.com/abc.m3u8',
    'not a url',
    ''
  ])('rejects %j', (url) => {
    expect(isMediaUrl(url)).toBe(false)
  })
})

describe('reorderMasterPlaylist', () => {
  it('puts the highest-bandwidth variant first', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      variantLine(1064000, '640x360'),
      '360/index.m3u8',
      variantLine(6640000, '1920x1080'),
      '1080/index.m3u8',
      variantLine(3640000, '1280x720'),
      '720/index.m3u8'
    ].join('\n')

    const lines = reorderMasterPlaylist(text, BASE)!.split('\n').filter(Boolean)

    expect(lines.slice(0, 2)).toEqual(['#EXTM3U', '#EXT-X-VERSION:3'])
    expect(lines.slice(2)).toEqual([
      variantLine(6640000, '1920x1080'),
      `${BASE.replace('master.m3u8', '1080/index.m3u8')}`,
      variantLine(3640000, '1280x720'),
      `${BASE.replace('master.m3u8', '720/index.m3u8')}`,
      variantLine(1064000, '640x360'),
      `${BASE.replace('master.m3u8', '360/index.m3u8')}`
    ])
  })

  it('makes every URI absolute', () => {
    const text = ['#EXTM3U', variantLine(1000), 'low/stream.m3u8'].join('\n')
    expect(reorderMasterPlaylist(text, BASE)).toContain(
      'https://cdn.jwplayer.com/v2/media/abc123/low/stream.m3u8'
    )
  })

  it('keeps header tags in place and absolutizes their URIs', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",URI="../audio/en.m3u8"',
      variantLine(1000),
      'video.m3u8'
    ].join('\n')

    const out = reorderMasterPlaylist(text, BASE)!

    expect(out).toContain('URI="https://cdn.jwplayer.com/v2/media/audio/en.m3u8"')
    expect(out.indexOf('#EXT-X-MEDIA')).toBeLessThan(out.indexOf('#EXT-X-STREAM-INF'))
  })

  it('normalizes CRLF and blank lines to the HLS line format', () => {
    const text = ['#EXTM3U', variantLine(1000), 'a.m3u8'].join('\r\n') + '\r\n\r\n'
    const out = reorderMasterPlaylist(text, BASE)!
    expect(out).not.toContain('\r')
    expect(out.split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('preserves the listed order for equal bandwidth', () => {
    const text = ['#EXTM3U', variantLine(1000), 'a.m3u8', variantLine(1000), 'b.m3u8'].join('\n')
    const lines = reorderMasterPlaylist(text, BASE)!.split('\n').filter(Boolean)
    expect(lines.slice(1)).toEqual([
      variantLine(1000),
      'https://cdn.jwplayer.com/v2/media/abc123/a.m3u8',
      variantLine(1000),
      'https://cdn.jwplayer.com/v2/media/abc123/b.m3u8'
    ])
  })

  it('sorts variants without a reported bandwidth last', () => {
    const text = ['#EXTM3U', variantLine(null, '640x360'), 'low.m3u8', variantLine(500000), 'high.m3u8'].join(
      '\n'
    )
    const out = reorderMasterPlaylist(text, BASE)!
    expect(out.indexOf('500000')).toBeLessThan(out.indexOf('640x360'))
  })

  it('returns null for a media playlist', () => {
    const media = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'seg1.ts',
      '#EXT-X-ENDLIST'
    ].join('\n')
    expect(reorderMasterPlaylist(media, BASE)).toBeNull()
  })

  it('returns null when a variant has no URI after it', () => {
    expect(reorderMasterPlaylist(['#EXTM3U', variantLine(1000)].join('\n'), BASE)).toBeNull()
  })

  it('returns null when the playlist has no variants', () => {
    expect(reorderMasterPlaylist('#EXTM3U\n#EXT-X-VERSION:3', BASE)).toBeNull()
  })
})

describe('fetchMasterPlaylist', () => {
  const master = [
    '#EXTM3U',
    variantLine(1064000, '640x360'),
    '360/index.m3u8',
    variantLine(6640000, '1920x1080'),
    '1080/index.m3u8'
  ].join('\n')

  it('refuses hosts outside the media CDN without fetching', async () => {
    await expect(fetchMasterPlaylist('https://example.com/master.m3u8')).rejects.toThrow(
      'Stream host not allowed'
    )
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('returns the rewritten master playlist', async () => {
    net.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => master })

    const playlist = await fetchMasterPlaylist(BASE)

    expect(playlist.indexOf('1920x1080')).toBeLessThan(playlist.indexOf('640x360'))
    expect(playlist).toContain('https://cdn.jwplayer.com/v2/media/abc123/1080/index.m3u8')
  })

  it('returns a media playlist unchanged', async () => {
    const media = ['#EXTM3U', '#EXTINF:10,', 'seg1.ts'].join('\n')
    net.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => media })

    await expect(fetchMasterPlaylist(BASE)).resolves.toBe(media)
  })

  it('reports an HTTP failure', async () => {
    net.fetch.mockResolvedValue({ ok: false, status: 404 })

    await expect(fetchMasterPlaylist(BASE)).rejects.toThrow('HTTP 404')
  })

  it('serves a replay from the cache', async () => {
    net.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => master })

    await fetchMasterPlaylist(BASE)
    await fetchMasterPlaylist(BASE)

    expect(net.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('fetchCaptionFile', () => {
  const caption = 'https://cdn.jwplayer.com/captions/en.vtt'

  it('refuses hosts outside the media CDN', async () => {
    await expect(fetchCaptionFile('https://example.com/en.vtt')).rejects.toThrow(
      'Caption host not allowed'
    )
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('returns the caption text', async () => {
    net.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'WEBVTT' })

    await expect(fetchCaptionFile(caption)).resolves.toBe('WEBVTT')
    expect(net.fetch).toHaveBeenCalledWith(caption)
  })

  it('reports an HTTP failure', async () => {
    net.fetch.mockResolvedValue({ ok: false, status: 500 })

    await expect(fetchCaptionFile(caption)).rejects.toThrow('HTTP 500')
  })
})
