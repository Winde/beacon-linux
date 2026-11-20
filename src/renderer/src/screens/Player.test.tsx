// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptionTrack, NextEpisode, PlaybackData } from '@shared/types'
import { Player, type PlayerHandle } from './Player'

const hlsMock = vi.hoisted(() => ({
  instances: [] as Array<{
    config?: Record<string, unknown>
    levels: { height: number; bitrate: number }[]
    audioTracks: { name?: string; lang?: string }[]
    audioTrack: number
    currentLevel: number
    subtitleDisplay: boolean
    subtitleTrack: number
    destroy: ReturnType<typeof vi.fn>
    emit: (event: string, ...args: unknown[]) => void
  }>
}))

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = (): boolean => true
    config?: Record<string, unknown>
    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'manifestParsed',
      LEVEL_SWITCHED: 'levelSwitched',
      AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
      AUDIO_TRACK_SWITCHED: 'audioTrackSwitched'
    }
    levels: { height: number; bitrate: number }[] = []
    audioTracks: { name?: string; lang?: string }[] = []
    audioTrack = -1
    currentLevel = -1
    subtitleDisplay = true
    subtitleTrack = 0
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
    private listeners = new Map<string, Array<(...args: any[]) => void>>()

    constructor(config?: Record<string, unknown>) {
      this.config = config
      hlsMock.instances.push(this)
    }

    on(event: string, handler: (...args: any[]) => void): void {
      const handlers = this.listeners.get(event) ?? []
      handlers.push(handler)
      this.listeners.set(event, handlers)
    }

    emit = (event: string, ...args: unknown[]): void => {
      for (const handler of this.listeners.get(event) ?? []) handler(event, ...args)
    }
  }
  return { default: FakeHls }
})

const playback: PlaybackData = {
  id: 'v1',
  title: 'Test Episode',
  url: 'https://cdn.example/master.m3u8',
  playlist: null,
  duration: 600,
  resumeAt: 0,
  captions: [
    { label: 'English', url: 'https://cdn.example/en.vtt' },
    { label: 'Deutsch', url: 'https://cdn.example/de.vtt' }
  ],
  episodeNumber: null,
  collection: null
}

function stubBeacon(captions: CaptionTrack[] = playback.captions): ReturnType<typeof vi.fn> {
  const fetchCaptions = vi.fn(() => Promise.resolve('WEBVTT\n\n00:00.000 --> 00:02.000\nHello'))
  vi.stubGlobal('beacon', {
    playback: {
      open: vi.fn(() => Promise.resolve({ ...playback, captions })),
      next: vi.fn(() => Promise.resolve(null)),
      start: vi.fn(() => Promise.resolve(true)),
      progress: vi.fn(() => Promise.resolve(true)),
      flush: vi.fn(() => Promise.resolve(true)),
      captions: fetchCaptions
    },
    app: { toggleFullscreen: vi.fn() }
  })
  return fetchCaptions
}

/** A stream with its own resume point, and optionally a caption fetch that fails. */
function stubBeaconWith(
  data: PlaybackData,
  fetchCaptions: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve('WEBVTT'))
): void {
  vi.stubGlobal('beacon', {
    playback: {
      open: vi.fn(() => Promise.resolve(data)),
      next: vi.fn(() => Promise.resolve(null)),
      start: vi.fn(() => Promise.resolve(true)),
      progress: vi.fn(() => Promise.resolve(true)),
      flush: vi.fn(() => Promise.resolve(true)),
      captions: fetchCaptions
    },
    app: { toggleFullscreen: vi.fn() }
  })
}

/** A player whose open request answers (or fails) however the test asks. */
function stubOpen(open: () => Promise<PlaybackData | null>): void {
  vi.stubGlobal('beacon', {
    playback: {
      open: vi.fn(open),
      next: vi.fn(() => Promise.resolve(null)),
      start: vi.fn(() => Promise.resolve(true)),
      progress: vi.fn(() => Promise.resolve(true)),
      flush: vi.fn(() => Promise.resolve(true)),
      captions: vi.fn(() => Promise.resolve('WEBVTT'))
    },
    app: { toggleFullscreen: vi.fn() }
  })
}

/** A series episode, so the player asks for what comes next. */
const episode: PlaybackData = {
  ...playback,
  id: 'c3-e121',
  title: 'C3 E121 | A New Age Begins | Part 1',
  episodeNumber: 121,
  collection: { id: 'c3', isSeries: true }
}

const partTwo: NextEpisode = {
  slug: 'c3-e121-a-new-age-begins-part-2',
  title: 'C3 E121 | A New Age Begins | Part 2',
  image: null,
  minutes: 240,
  autoplayDisabled: false
}

function stubEpisode(
  overrides: Partial<PlaybackData> = {},
  next: NextEpisode | null = partTwo
): ReturnType<typeof vi.fn> {
  const request = vi.fn(() => Promise.resolve(next))
  vi.stubGlobal('beacon', {
    playback: {
      open: vi.fn(() => Promise.resolve({ ...episode, ...overrides })),
      next: request,
      start: vi.fn(() => Promise.resolve(true)),
      progress: vi.fn(() => Promise.resolve(true)),
      flush: vi.fn(() => Promise.resolve(true)),
      captions: vi.fn(() => Promise.resolve('WEBVTT'))
    },
    app: { toggleFullscreen: vi.fn() }
  })
  return request
}

/** Put the element's clock where the card belongs. */
function playTo(container: HTMLElement, at: number): void {
  const video = container.querySelector('video') as HTMLVideoElement
  Object.defineProperty(video, 'duration', { configurable: true, value: 600 })
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: at })
  act(() => {
    video.dispatchEvent(new Event('durationchange'))
    video.dispatchEvent(new Event('timeupdate'))
  })
}

beforeEach(() => {
  hlsMock.instances.length = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:captions')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('Player', () => {
  it('shows real controls instead of the key hint line', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)

    expect(await screen.findByText('Test Episode')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Subtitles: off' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Playback speed: 1×' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeDefined()

    expect(screen.queryByText(/LT\/RT/)).toBeNull()
    expect(screen.queryByText(/X subtitles/)).toBeNull()
  })

  it('starts a view once and reports only after ten seconds of playback', async () => {
    const progress = vi.fn(() => Promise.resolve(true))
    const start = vi.fn(() => Promise.resolve(true))
    const flush = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('beacon', {
      playback: {
        open: vi.fn(() => Promise.resolve(playback)),
        next: vi.fn(() => Promise.resolve(null)),
        start,
        progress,
        flush,
        captions: vi.fn(() => Promise.resolve('WEBVTT'))
      },
      app: { toggleFullscreen: vi.fn() }
    })

    const { container, unmount } = render(
      <Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith('v1'))

    playTo(container, 100)
    expect(progress).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenLastCalledWith({ contentId: 'v1', position: 100, duration: 600 })

    playTo(container, 105)
    expect(progress).toHaveBeenCalledTimes(1)

    playTo(container, 111)
    expect(progress).toHaveBeenCalledTimes(2)

    unmount()
    expect(flush).toHaveBeenCalled()
    expect(progress).toHaveBeenLastCalledWith({ contentId: 'v1', position: 111, duration: 600 })
  })

  it('keeps hls.js from creating or drawing its own subtitle tracks', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)

    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    const hls = hlsMock.instances[0]!
    expect(hls.config).toMatchObject({
      renderTextTracksNatively: false,
      enableCEA708Captions: false
    })
    expect(hls.subtitleDisplay).toBe(false)
    act(() => hls.emit('manifestParsed'))
    expect(hls.subtitleTrack).toBe(-1)
  })

  it('opens the subtitle menu from the control bar and turns captions on', async () => {
    const fetchCaptions = stubBeacon()
    const ref = createRef<PlayerHandle>()
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right')) // Play -> Subtitles
    act(() => void ref.current?.handle('accept'))

    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeDefined()

    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('accept'))

    expect(fetchCaptions).toHaveBeenCalledWith('https://cdn.example/en.vtt')
    expect(await screen.findByRole('button', { name: 'Subtitles: English' })).toBeDefined()
  })

  it('hides the controls with B, then leaves the player with a second B', async () => {
    stubBeacon()
    const onClose = vi.fn()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={onClose} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    act(() => void ref.current?.handle('back'))
    expect(container.querySelector('.player__chrome')?.classList.contains('is-visible')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    act(() => void ref.current?.handle('back'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('auto-hides the controls when idle and shows them again on input', async () => {
    stubBeacon()
    vi.useFakeTimers()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await act(async () => {
      await Promise.resolve()
    })

    const chrome = container.querySelector('.player__chrome')
    expect(chrome?.classList.contains('is-visible')).toBe(true)

    act(() => vi.advanceTimersByTime(4100))
    expect(chrome?.classList.contains('is-visible')).toBe(false)

    act(() => void ref.current?.handle('right'))
    expect(chrome?.classList.contains('is-visible')).toBe(true)
    vi.useRealTimers()
  })

  it('says so when a video has no subtitle track', async () => {
    stubBeacon([])
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')

    fireEvent.click(screen.getByRole('button', { name: 'Subtitles: off' }))

    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeDefined()
    expect(screen.getByText('This video has no subtitles.')).toBeDefined()
  })

  it('scrubs in deliberate taps, accelerates while held, and jumps on accept', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 })
    video.currentTime = 120
    act(() => {
      video.dispatchEvent(new Event('durationchange'))
      video.dispatchEvent(new Event('timeupdate'))
    })

    // Up from the idle overlay lands on the seek bar while paused.
    act(() => void ref.current?.handle('up'))
    const progress = container.querySelector('.player__progress')
    expect(progress?.classList.contains('is-scrubbing')).toBe(true)

    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    act(() => void ref.current?.handle('right'))
    expect(screen.getByText('2:10')).toBeDefined()

    // A repeat 100ms later is still the same hold, so the step grows.
    now.mockReturnValue(1100)
    act(() => void ref.current?.handle('right'))
    expect(screen.getByText('2:25')).toBeDefined()

    // Stopping for a moment resets the next tap to its precise step.
    now.mockReturnValue(2000)
    act(() => void ref.current?.handle('right'))
    expect(screen.getByText('2:35')).toBeDefined()

    const play = vi.spyOn(video, 'play').mockResolvedValue()
    act(() => void ref.current?.handle('accept'))
    expect(video.currentTime).toBe(155)
    expect(play).not.toHaveBeenCalled()

    // Accepting again without moving the marker starts playback.
    act(() => void ref.current?.handle('accept'))
    expect(play).toHaveBeenCalledTimes(1)
    expect(progress?.classList.contains('is-scrubbing')).toBe(false)
  })

  it('keeps the 10 second skip while the video is playing', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    video.currentTime = 100
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('durationchange'))
      video.dispatchEvent(new Event('timeupdate'))
    })

    act(() => void ref.current?.handle('right'))
    expect(video.currentTime).toBe(110)

    // Up still focuses the control bar, never the paused-only scrubber.
    act(() => void ref.current?.handle('up'))
    expect(container.querySelector('.player__progress')?.classList.contains('is-scrubbing')).toBe(
      false
    )
  })

  it('disables the quality control when the stream has one rendition', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    const hls = hlsMock.instances[0]!
    hls.levels = [{ height: 1080, bitrate: 5_000_000 }]
    act(() => hls.emit('manifestParsed'))

    const quality = screen.getByRole('button', { name: 'Quality: 1080p (fixed)' })
    expect((quality as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(quality)
    expect(screen.queryByRole('menu', { name: 'Quality' })).toBeNull()

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right')) // Play -> Subtitles
    act(() => void ref.current?.handle('right')) // Quality is skipped
    act(() => void ref.current?.handle('accept'))

    expect(screen.getByRole('menu', { name: 'Playback speed' })).toBeDefined()
  })

  it('opens the quality menu when the stream has several renditions', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    const hls = hlsMock.instances[0]!
    hls.levels = [
      { height: 360, bitrate: 800_000 },
      { height: 1080, bitrate: 5_000_000 }
    ]
    act(() => hls.emit('manifestParsed'))

    const quality = screen.getByRole('button', { name: 'Quality: Auto' })
    expect((quality as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(quality)

    expect(screen.getByRole('menu', { name: 'Quality' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: 'Auto' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: '1080p' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: '360p' })).toBeDefined()
    expect(screen.queryByText('Quality is fixed for this stream.')).toBeNull()
  })

  it('offers the next episode in the last fifteen seconds', async () => {
    const request = stubEpisode()
    const onPlayNext = vi.fn()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="c3-e121" onClose={vi.fn()} onPlayNext={onPlayNext} />
    )
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        contentId: 'c3-e121',
        collectionId: 'c3',
        isSeries: true
      })
    )

    playTo(container, 590)

    expect(screen.getByText('Up next')).toBeDefined()
    expect(screen.getByText(/Playing in 10s/)).toBeDefined()

    act(() => void ref.current?.handle('accept'))
    expect(onPlayNext).toHaveBeenCalledWith('c3-e121-a-new-age-begins-part-2')
  })

  it('stays quiet before the ending window', async () => {
    const request = stubEpisode()
    const { container } = render(<Player slug="c3-e121" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')
    await vi.waitFor(() => expect(request).toHaveBeenCalled())

    playTo(container, 540)

    expect(screen.queryByText('Up next')).toBeNull()
  })

  it('takes B as "not this one", once', async () => {
    stubEpisode()
    const onClose = vi.fn()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="c3-e121" onClose={onClose} onPlayNext={vi.fn()} />
    )
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')
    playTo(container, 590)
    await vi.waitFor(() => expect(screen.queryByText('Up next')).not.toBeNull())

    act(() => void ref.current?.handle('back'))

    expect(screen.queryByText('Up next')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    // Coming back into the window later does not revive the card.
    playTo(container, 598)
    expect(screen.queryByText('Up next')).toBeNull()
  })

  it('moves on when the stream itself ends', async () => {
    stubEpisode()
    const onPlayNext = vi.fn()
    const { container } = render(
      <Player slug="c3-e121" onClose={vi.fn()} onPlayNext={onPlayNext} />
    )
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')
    playTo(container, 598)
    await vi.waitFor(() => expect(screen.queryByText('Up next')).not.toBeNull())

    const video = container.querySelector('video') as HTMLVideoElement
    act(() => {
      video.dispatchEvent(new Event('ended'))
    })

    expect(onPlayNext).toHaveBeenCalledWith('c3-e121-a-new-age-begins-part-2')
  })

  it('leaves a disabled next episode for a click', async () => {
    stubEpisode({}, { ...partTwo, autoplayDisabled: true })
    const onPlayNext = vi.fn()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="c3-e121" onClose={vi.fn()} onPlayNext={onPlayNext} />
    )
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')
    playTo(container, 590)
    await vi.waitFor(() => expect(screen.queryByText('Up next')).not.toBeNull())

    expect(screen.getByText(/Play next/)).toBeDefined()
    expect(screen.queryByText(/Playing in/)).toBeNull()

    const video = container.querySelector('video') as HTMLVideoElement
    act(() => {
      video.dispatchEvent(new Event('ended'))
    })
    expect(onPlayNext).not.toHaveBeenCalled()

    act(() => void ref.current?.handle('accept'))
    expect(onPlayNext).toHaveBeenCalledWith('c3-e121-a-new-age-begins-part-2')
  })

  it('asks for next for a series without an episode number', async () => {
    const request = stubEpisode({ episodeNumber: null })
    render(<Player slug="c3-e121" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        contentId: 'c3-e121',
        collectionId: 'c3',
        isSeries: true
      })
    )
  })

  it('asks nothing for a video in a collection folder', async () => {
    const request = stubEpisode({ collection: { id: 'one-shots', isSeries: false } })
    render(<Player slug="one-shot" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')

    expect(request).not.toHaveBeenCalled()
  })

  it('stays quiet when there is nothing next', async () => {
    const request = stubEpisode({}, null)
    const { container } = render(<Player slug="c3-e121" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('C3 E121 | A New Age Begins | Part 1')
    await vi.waitFor(() => expect(request).toHaveBeenCalled())

    playTo(container, 595)

    expect(screen.queryByText('Up next')).toBeNull()
  })

  it('resumes from the stored point when the stream is ready', async () => {
    stubBeaconWith({ ...playback, resumeAt: 120 })
    const { container } = render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')

    const video = container.querySelector('video') as HTMLVideoElement
    const play = vi.spyOn(video, 'play').mockResolvedValue()
    act(() => video.dispatchEvent(new Event('loadedmetadata')))

    expect(video.currentTime).toBe(120)
    expect(play).toHaveBeenCalled()
  })

  it('lets an explicit start point win over the stored one', async () => {
    stubBeaconWith({ ...playback, resumeAt: 120 })
    const { container } = render(
      <Player slug="v1" startAt={0} onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    const video = container.querySelector('video') as HTMLVideoElement
    vi.spyOn(video, 'play').mockResolvedValue()
    act(() => video.dispatchEvent(new Event('loadedmetadata')))

    expect(video.currentTime).toBe(0)
  })

  it('seeks a full minute with LT/RT and applies it to the scrubber', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 })
    video.currentTime = 100
    act(() => {
      video.dispatchEvent(new Event('durationchange'))
      video.dispatchEvent(new Event('timeupdate'))
    })

    act(() => void ref.current?.handle('seekForward'))
    expect(video.currentTime).toBe(160)

    act(() => void ref.current?.handle('up'))
    act(() => void ref.current?.handle('seekBack'))
    expect(screen.getByText('1:40')).toBeDefined()
  })

  it('changes playback speed from the control bar', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { container } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right')) // Play -> Subtitles
    act(() => void ref.current?.handle('right')) // Subtitles -> Speed
    act(() => void ref.current?.handle('accept'))
    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('accept'))

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.playbackRate).toBe(1.5)
    expect(screen.getByRole('button', { name: 'Playback speed: 1.5×' })).toBeDefined()
  })

  it('offers audio tracks only when there is more than one', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    const hls = hlsMock.instances[0]!
    expect(screen.queryByRole('button', { name: /Audio:/ })).toBeNull()

    hls.audioTracks = [{ name: 'English' }, { name: 'Deutsch' }]
    act(() => hls.emit('audioTracksUpdated'))

    fireEvent.click(screen.getByRole('button', { name: 'Audio: English' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }))

    expect(hls.audioTrack).toBe(1)
    expect(screen.getByRole('button', { name: 'Audio: Deutsch' })).toBeDefined()
  })

  it('sets the chosen quality level on the player', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    const hls = hlsMock.instances[0]!
    hls.levels = [
      { height: 360, bitrate: 800_000 },
      { height: 1080, bitrate: 5_000_000 }
    ]
    act(() => hls.emit('manifestParsed'))

    fireEvent.click(screen.getByRole('button', { name: 'Quality: Auto' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '360p' }))

    expect(hls.currentLevel).toBe(0)
    expect(screen.getByRole('button', { name: 'Quality: 360p' })).toBeDefined()
  })

  it('remembers the chosen subtitle language', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right'))
    act(() => void ref.current?.handle('accept'))
    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('accept'))

    expect(window.localStorage.getItem('beacon.player.subtitles')).toBe('English')
  })

  it('says when a subtitle file cannot be fetched', async () => {
    stubBeaconWith(
      playback,
      vi.fn(() => Promise.reject(new Error('offline')))
    )
    const ref = createRef<PlayerHandle>()
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right'))
    act(() => void ref.current?.handle('accept'))
    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('accept'))

    // The failed fetch is reported when the menu is next opened.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles: English' }))

    expect(await screen.findByText('Subtitles could not be loaded.')).toBeDefined()
  })

  it('says when the video is not available instead of spinning forever', async () => {
    stubOpen(() => Promise.resolve(null))
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)

    expect(await screen.findByText('This video is not available for your account.')).toBeDefined()
    expect(screen.queryByText('Starting stream')).toBeNull()
  })

  it('shows a clean message when the stream cannot be opened', async () => {
    stubOpen(() =>
      Promise.reject(new Error("Error invoking remote method 'playback:open': Error: Network down"))
    )
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)

    expect(await screen.findByText('Network down')).toBeDefined()
  })

  it('reports a fatal stream error', async () => {
    stubBeacon()
    render(<Player slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />)
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))

    act(() => hlsMock.instances[0]!.emit('hlsError', { fatal: true, details: 'networkError' }))

    expect(await screen.findByText('Playback failed (networkError).')).toBeDefined()
  })

  it('destroys the stream and revokes caption blobs when it closes', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { unmount } = render(
      <Player ref={ref} slug="v1" onClose={vi.fn()} onPlayNext={vi.fn()} />
    )
    await screen.findByText('Test Episode')
    await vi.waitFor(() => expect(hlsMock.instances).toHaveLength(1))
    const hls = hlsMock.instances[0]!

    act(() => void ref.current?.handle('menu'))
    act(() => void ref.current?.handle('right'))
    act(() => void ref.current?.handle('accept'))
    act(() => void ref.current?.handle('down'))
    act(() => void ref.current?.handle('accept'))
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())

    unmount()

    expect(hls.destroy).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:captions')
  })
})
