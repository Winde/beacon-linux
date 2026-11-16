// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptionTrack, PlaybackData } from '@shared/types'
import { Player, type PlayerHandle } from './Player'

const hlsMock = vi.hoisted(() => ({
  instances: [] as Array<{
    levels: { height: number; bitrate: number }[]
    emit: (event: string) => void
  }>
}))

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = (): boolean => true
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
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
    private listeners = new Map<string, Array<() => void>>()

    constructor() {
      hlsMock.instances.push(this)
    }

    on(event: string, handler: () => void): void {
      const handlers = this.listeners.get(event) ?? []
      handlers.push(handler)
      this.listeners.set(event, handlers)
    }

    emit = (event: string): void => {
      for (const handler of this.listeners.get(event) ?? []) handler()
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
  ]
}

function stubBeacon(captions: CaptionTrack[] = playback.captions): ReturnType<typeof vi.fn> {
  const fetchCaptions = vi.fn(() => Promise.resolve('WEBVTT\n\n00:00.000 --> 00:02.000\nHello'))
  vi.stubGlobal('beacon', {
    playback: {
      open: vi.fn(() => Promise.resolve({ ...playback, captions })),
      progress: vi.fn(() => Promise.resolve(true)),
      captions: fetchCaptions
    },
    app: { toggleFullscreen: vi.fn() }
  })
  return fetchCaptions
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
    render(<Player slug="v1" onClose={vi.fn()} />)

    expect(await screen.findByText('Test Episode')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Subtitles: off' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Playback speed: 1×' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeDefined()

    expect(screen.queryByText(/LT\/RT/)).toBeNull()
    expect(screen.queryByText(/X subtitles/)).toBeNull()
  })

  it('opens the subtitle menu from the control bar and turns captions on', async () => {
    const fetchCaptions = stubBeacon()
    const ref = createRef<PlayerHandle>()
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} />)
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
    const { container } = render(<Player ref={ref} slug="v1" onClose={onClose} />)
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
    const { container } = render(<Player ref={ref} slug="v1" onClose={vi.fn()} />)
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
    render(<Player slug="v1" onClose={vi.fn()} />)
    await screen.findByText('Test Episode')

    fireEvent.click(screen.getByRole('button', { name: 'Subtitles: off' }))

    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeDefined()
    expect(screen.getByText('This video has no subtitles.')).toBeDefined()
  })

  it('scrubs in deliberate taps, accelerates while held, and jumps on accept', async () => {
    stubBeacon()
    const ref = createRef<PlayerHandle>()
    const { container } = render(<Player ref={ref} slug="v1" onClose={vi.fn()} />)
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
    const { container } = render(<Player ref={ref} slug="v1" onClose={vi.fn()} />)
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
    render(<Player ref={ref} slug="v1" onClose={vi.fn()} />)
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
    render(<Player slug="v1" onClose={vi.fn()} />)
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
})
