import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type HlsPlayer from 'hls.js'
import {
  Check,
  ClosedCaptionsTagSolid,
  DashboardSpeed,
  HdDisplay,
  Headset,
  Maximize,
  NavArrowLeft,
  Pause,
  Play
} from 'iconoir-react'
import type { NextEpisode, PlaybackData } from '@shared/types'
import type { Action } from '../input/useInput'
import { cleanError } from '../lib/errors'
import { ErrorNote, Spinner } from '../components/ui'

export interface PlayerHandle {
  handle(action: Action): boolean
}

interface PlayerProps {
  slug: string
  startAt?: number
  onClose: () => void
  /** Move the player on to the episode the ending one leads into. */
  onPlayNext: (slug: string) => void
  ref?: React.Ref<PlayerHandle>
}

type Panel = 'subtitles' | 'audio' | 'quality' | 'speed'
type BarId =
  | 'exit'
  | 'play'
  | 'subtitles'
  | 'audio'
  | 'quality'
  | 'speed'
  | 'fullscreen'

interface QualityLevel {
  /** Index into hls.levels. */
  index: number
  height: number | null
  bitrate: number
}

interface MenuOption {
  key: string
  label: string
  selected: boolean
  run: () => void
}

const CONTROLS_TIMEOUT = 4000
const SEEK_STEP = 10
const SEEK_JUMP = 60
const SCRUB_HOLD_GAP = 350
const SCRUB_ACCELERATION = 1.5
const SCRUB_MIN_CEILING = 30
const SCRUB_MAX_CEILING = 120
const REPORT_EVERY = 15000
const SUBTITLE_KEY = 'beacon.player.subtitles'
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
/**
 * How long the "up next" card sits over the ending. Fifteen seconds is the
 * television default Plex landed on; Netflix's five is the aggressive end of
 * the range and reads as a grab. Long credits are the reason there is a window
 * at all, and B is this player's "watch the credits".
 */
const UPNEXT_WINDOW = 15

const PANEL_TITLES: Record<Panel, string> = {
  subtitles: 'Subtitles',
  audio: 'Audio',
  quality: 'Quality',
  speed: 'Playback speed'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

function levelLabel(level: QualityLevel | undefined): string {
  if (!level) return 'Auto'
  if (level.height) return `${level.height}p`
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`
  return 'Level'
}

function speedLabel(speed: number): string {
  return `${speed}×`
}

export function Player({ slug, startAt, onClose, onPlayNext, ref }: PlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsPlayer | null>(null)
  const blobRef = useRef<string | null>(null)
  const captionCache = useRef(new Map<string, string>())
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const anchorRefs = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const lastRef = useRef({ position: 0, duration: 0 })
  const hideTimer = useRef<number | undefined>(undefined)
  const panelRef = useRef(false)
  const scrubMotion = useRef({ direction: 0, at: 0, step: 0 })
  const scrubJumped = useRef(false)

  const [data, setData] = useState<PlaybackData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [focusBar, setFocusBar] = useState(false)
  const [barFocus, setBarFocus] = useState<BarId>('play')
  const [scrubFocus, setScrubFocus] = useState(false)
  const [scrubAt, setScrubAt] = useState(0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [panelPosition, setPanelPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [optionFocus, setOptionFocus] = useState(0)

  const [captionIndex, setCaptionIndex] = useState<number | null>(null)
  const [captionUrl, setCaptionUrl] = useState<string | null>(null)
  const [captionError, setCaptionError] = useState<string | null>(null)

  const [levels, setLevels] = useState<QualityLevel[]>([])
  const [quality, setQuality] = useState(-1)
  const [activeLevel, setActiveLevel] = useState(-1)
  const [audioTracks, setAudioTracks] = useState<string[]>([])
  const [audioTrack, setAudioTrack] = useState(0)
  const [speed, setSpeed] = useState(1)

  const [upNext, setUpNext] = useState<NextEpisode | null>(null)
  const [upNextDismissed, setUpNextDismissed] = useState(false)

  // A menu stays open until it is dismissed; the bar itself may fade.
  useEffect(() => {
    panelRef.current = panel !== null
  }, [panel])

  // Seeking from the bar only exists while paused. If playback starts again
  // (a click on the video, say), the bar must stop behaving as a scrubber.
  useEffect(() => {
    if (playing) setScrubFocus(false)
  }, [playing])

  const poke = useCallback(() => {
    setShowControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (panelRef.current) return
      setShowControls(false)
      setFocusBar(false)
      setScrubFocus(false)
    }, CONTROLS_TIMEOUT)
  }, [])

  // Load the stream and attach it to the video element.
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)

    window.beacon.playback
      .open(slug)
      .then(async (playback) => {
        if (cancelled) return
        if (!playback) {
          setError('This video is not available for your account.')
          return
        }
        setData(playback)

        const video = videoRef.current
        if (!video) return

        let source = playback.url
        if (playback.playlist) {
          blobRef.current = URL.createObjectURL(
            new Blob([playback.playlist], { type: 'application/vnd.apple.mpegurl' })
          )
          source = blobRef.current
        }

        // hls.js is most of the renderer bundle. Loading it here keeps the
        // browse screens' startup chunk small; a stream is the only thing that
        // needs it.
        let Hls: typeof import('hls.js').default | null = null
        try {
          Hls = (await import('hls.js')).default
        } catch {
          // Fall through to the engine's own player, or the error below.
        }
        if (cancelled) return

        if (Hls?.isSupported()) {
          const hls = new Hls({ enableWorker: true })
          // Beacon's captions are fetched as a separate VTT file and drawn by
          // the renderer. Left on, hls.js also renders the stream's own
          // subtitle track, which paints every cue twice.
          hls.subtitleDisplay = false

          const syncTracks = (): void => {
            setLevels(
              hls.levels.map((level, index) => ({
                index,
                height: level.height || null,
                bitrate: level.bitrate || 0
              }))
            )
            setAudioTracks(
              hls.audioTracks.map((track, index) => track.name || track.lang || `Track ${index + 1}`)
            )
            setAudioTrack(hls.audioTrack >= 0 ? hls.audioTrack : 0)
          }

          hls.loadSource(source)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, syncTracks)
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncTracks)
          hls.on(Hls.Events.LEVEL_SWITCHED, (_event, payload) => setActiveLevel(payload.level))
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, payload) => setAudioTrack(payload.id))
          hls.on(Hls.Events.ERROR, (_event, payload) => {
            if (payload.fatal) setError(`Playback failed (${payload.details}).`)
          })
          hlsRef.current = hls
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = source
        } else {
          setError('This system cannot play HLS video.')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(cleanError(err))
      })

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }
  }, [slug])

  // Resume where the account left off, then start playing.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !data) return

    const start = (): void => {
      const target = startAt ?? data.resumeAt
      if (target > 5) video.currentTime = target
      setDuration(video.duration || data.duration || 0)
      void video.play().catch(() => {
        // Autoplay can still be refused; the player stays paused and usable.
      })
    }

    if (video.readyState >= 1) {
      start()
      return
    }
    video.addEventListener('loadedmetadata', start, { once: true })
    return () => video.removeEventListener('loadedmetadata', start)
  }, [data, startAt])

  // Ask for the next episode once the stream is known. One small query runs
  // alongside playback, so the card is ready long before the ending and a
  // failure costs nothing: the video simply ends where it ends.
  useEffect(() => {
    if (!data?.collection?.isSeries || data.episodeNumber == null) return
    let cancelled = false
    window.beacon.playback
      .next({
        contentId: data.id,
        collectionId: data.collection.id,
        isSeries: data.collection.isSeries,
        episodeNumber: data.episodeNumber
      })
      .then((episode) => {
        if (!cancelled) setUpNext(episode)
      })
      .catch(() => {
        // Nothing to offer; the video just ends.
      })
    return () => {
      cancelled = true
    }
  }, [data])

  // Playback decides when the episode is over, not the countdown: timeupdate
  // ticks at about 4 Hz and could miss the last frame. The card is a picture of
  // the remaining time, the element's own `ended` is the trigger.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = (): void => {
      if (upNext && !upNextDismissed) onPlayNext(upNext.slug)
    }
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [upNext, upNextDismissed, onPlayNext])

  // Mirror the element's state into React for the overlay.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = (): void => {
      setCurrent(video.currentTime)
      lastRef.current.position = video.currentTime
    }
    const onDuration = (): void => {
      const value = Number.isFinite(video.duration) ? video.duration : 0
      setDuration(value)
      lastRef.current.duration = value
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onRate = (): void => setSpeed(video.playbackRate)

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ratechange', onRate)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ratechange', onRate)
    }
  }, [])

  // Keep Beacon's "Continue watching" in sync with what we play.
  useEffect(() => {
    if (!data) return
    const report = (): void => {
      const { position, duration: total } = lastRef.current
      if (!total || position < 1) return
      void window.beacon.playback.progress({
        contentId: data.id,
        position,
        duration: total
      })
    }
    const timer = window.setInterval(report, REPORT_EVERY)
    return () => {
      window.clearInterval(timer)
      report()
    }
  }, [data])

  // Remember the chosen subtitle language and pick it again on the next video.
  useEffect(() => {
    if (!data?.captions.length) return
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(SUBTITLE_KEY)
    } catch {
      // Storage can be unavailable; captions still work for this session.
    }
    if (!saved) return
    const index = data.captions.findIndex((track) => track.label === saved)
    if (index >= 0) setCaptionIndex(index)
  }, [data])

  // Subtitles: JW Player's caption host sends no CORS headers, so the main
  // process fetches the file and we hand the player a local blob.
  useEffect(() => {
    const track = captionIndex == null ? null : data?.captions[captionIndex]
    if (!track) {
      setCaptionUrl(null)
      setCaptionError(null)
      return
    }

    const cached = captionCache.current.get(track.url)
    if (cached) {
      setCaptionUrl(cached)
      setCaptionError(null)
      return
    }

    let cancelled = false
    setCaptionUrl(null)
    setCaptionError(null)
    window.beacon.playback
      .captions(track.url)
      .then((text) => {
        if (cancelled) return
        const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
        captionCache.current.set(track.url, url)
        setCaptionUrl(url)
      })
      .catch(() => {
        if (!cancelled) setCaptionError('Subtitles could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [captionIndex, data])

  useEffect(() => {
    return () => {
      for (const url of captionCache.current.values()) URL.revokeObjectURL(url)
      captionCache.current.clear()
    }
  }, [])

  const caption = captionIndex == null ? undefined : data?.captions[captionIndex]

  useEffect(() => {
    const video = videoRef.current
    if (!video?.textTracks) return
    // Show only the externally fetched track. hls.js may have added its own
    // subtitle tracks for the same stream, and two visible tracks double-render.
    const own = video.querySelector<HTMLTrackElement>('track[data-own="captions"]')?.track ?? null
    for (const track of Array.from(video.textTracks)) {
      track.mode = captionUrl && track === own ? 'showing' : 'disabled'
    }
  }, [captionUrl, caption])

  // Hide the overlay after a few idle seconds, playing or paused. Only an open
  // menu holds it: otherwise a focused control would stay on screen forever.
  useEffect(() => {
    if (panel) return
    poke()
  }, [playing, panel, poke])

  useEffect(() => {
    return () => window.clearTimeout(hideTimer.current)
  }, [])

  useEffect(() => {
    if (!panel) return
    optionRefs.current[optionFocus]?.scrollIntoView?.({ block: 'nearest' })
  }, [panel, optionFocus])

  const seekBy = (delta: number): void => {
    const video = videoRef.current
    if (!video) return
    const total = Number.isFinite(video.duration) ? video.duration : 0
    const next = video.currentTime + delta
    video.currentTime = total ? Math.max(0, Math.min(total, next)) : Math.max(0, next)
  }

  const jump = (delta: number): void => {
    seekBy(delta)
    poke()
  }

  /** Put the seek bar in its paused scrub mode, with the marker at the playhead. */
  const startScrub = (): void => {
    const video = videoRef.current
    if (!video || !video.paused) return
    scrubMotion.current = { direction: 0, at: 0, step: 0 }
    scrubJumped.current = false
    setScrubAt(video.currentTime)
    setScrubFocus(true)
    setFocusBar(false)
    poke()
  }

  /**
   * A tap moves a precise 10 seconds. Holding a direction keeps moving, and
   * each repeat grows the step so a four-hour episode can still be crossed in
   * seconds. The ceiling scales with the video, so short clips do not leap
   * around when held.
   */
  const nudgeScrub = (direction: 1 | -1): void => {
    const video = videoRef.current
    if (!video) return
    const total = Number.isFinite(video.duration) ? video.duration : 0
    const ceiling = Math.min(SCRUB_MAX_CEILING, Math.max(SCRUB_MIN_CEILING, total / 30))
    const now = performance.now()
    const motion = scrubMotion.current
    const holding = motion.direction === direction && now - motion.at < SCRUB_HOLD_GAP
    const step = holding
      ? Math.min(ceiling, motion.step * SCRUB_ACCELERATION)
      : Math.min(ceiling, SEEK_STEP)
    scrubMotion.current = { direction, at: now, step }
    scrubJumped.current = false
    setScrubAt((value) => {
      const next = value + direction * step
      return total ? Math.max(0, Math.min(total, next)) : Math.max(0, next)
    })
    poke()
  }

  /** LT/RT always move a full minute; they also reset hold acceleration. */
  const jumpScrub = (delta: number): void => {
    const video = videoRef.current
    if (!video) return
    const total = Number.isFinite(video.duration) ? video.duration : 0
    scrubMotion.current = { direction: 0, at: 0, step: 0 }
    scrubJumped.current = false
    setScrubAt((value) => {
      const next = value + delta
      return total ? Math.max(0, Math.min(total, next)) : Math.max(0, next)
    })
    poke()
  }

  const commitScrub = (): void => {
    const video = videoRef.current
    if (!video) return
    scrubMotion.current = { direction: 0, at: 0, step: 0 }
    video.currentTime = scrubAt
    setCurrent(scrubAt)
    lastRef.current.position = scrubAt
    // A second accept without moving the marker starts playback.
    scrubJumped.current = true
    poke()
  }

  const playFromScrub = (): void => {
    const video = videoRef.current
    if (!video) return
    scrubJumped.current = false
    setScrubFocus(false)
    setFocusBar(false)
    void video.play().catch(() => {})
    poke()
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
    poke()
  }

  const playUpNext = (): void => {
    if (upNext) onPlayNext(upNext.slug)
  }

  const chooseCaptions = (index: number | null): void => {
    setCaptionIndex(index)
    try {
      if (index == null) window.localStorage.removeItem(SUBTITLE_KEY)
      else window.localStorage.setItem(SUBTITLE_KEY, data?.captions[index]?.label ?? '')
    } catch {
      // Preference is a convenience; playback does not depend on it.
    }
  }

  const chooseQuality = (index: number): void => {
    const hls = hlsRef.current
    if (!hls) return
    hls.currentLevel = index
    setQuality(index)
  }

  const chooseAudio = (index: number): void => {
    const hls = hlsRef.current
    if (!hls) return
    hls.audioTrack = index
    setAudioTrack(index)
  }

  const chooseSpeed = (value: number): void => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = value
    setSpeed(value)
  }

  const subtitleOptions: MenuOption[] = (data?.captions ?? []).map((track, index) => ({
    key: `subtitle-${index}`,
    label: track.label,
    selected: captionIndex === index,
    run: () => chooseCaptions(index)
  }))
  if (subtitleOptions.length) {
    subtitleOptions.unshift({
      key: 'subtitles-off',
      label: 'Off',
      selected: captionIndex == null,
      run: () => chooseCaptions(null)
    })
  }

  const qualityChoices = levels
    .slice()
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bitrate - a.bitrate)
    .filter(
      (level, index, all) =>
        level.height == null || all.findIndex((other) => other.height === level.height) === index
    )

  // A single rendition leaves nothing to choose. Keep the control visible so the
  // quality is still readable, but do not pretend it opens a menu.
  const qualityFixed = levels.length > 0 && qualityChoices.length <= 1

  const qualityOptions: MenuOption[] = levels.length
    ? [
        {
          key: 'quality-auto',
          label: 'Auto',
          selected: quality === -1,
          run: () => chooseQuality(-1)
        },
        ...qualityChoices.map((level) => ({
          key: `quality-${level.index}`,
          label: levelLabel(level),
          selected: quality === level.index,
          run: () => chooseQuality(level.index)
        }))
      ]
    : []

  const audioOptions: MenuOption[] = audioTracks.map((name, index) => ({
    key: `audio-${index}`,
    label: name,
    selected: audioTrack === index,
    run: () => chooseAudio(index)
  }))

  const speedOptions: MenuOption[] = SPEEDS.map((value) => ({
    key: `speed-${value}`,
    label: value === 1 ? 'Normal' : speedLabel(value),
    selected: speed === value,
    run: () => chooseSpeed(value)
  }))

  const optionsFor = (target: Panel): MenuOption[] => {
    switch (target) {
      case 'subtitles':
        return subtitleOptions
      case 'audio':
        return audioOptions
      case 'quality':
        return qualityOptions
      case 'speed':
        return speedOptions
    }
  }

  const options = panel ? optionsFor(panel) : []

  const openPanel = (target: Panel): void => {
    const list = optionsFor(target)
    const selected = list.findIndex((option) => option.selected)
    setOptionFocus(selected >= 0 ? selected : 0)
    setPanel(target)

    // Open just above the button that was pressed, kept inside the viewport.
    const anchor = anchorRefs.current[target]
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(340, window.innerWidth - 88)
      const half = width / 2
      const center = rect.left + rect.width / 2
      setPanelPosition({
        left: Math.max(44 + half, Math.min(window.innerWidth - 44 - half, center)),
        bottom: window.innerHeight - rect.top + 12
      })
    } else {
      setPanelPosition(null)
    }

    setFocusBar(true)
    setScrubFocus(false)
    setShowControls(true)
    window.clearTimeout(hideTimer.current)
  }

  const closePanel = (): void => {
    setPanel(null)
    poke()
  }

  const chooseOption = (index: number): void => {
    options[index]?.run()
    closePanel()
  }

  const barOrder: BarId[] = ['exit', 'play', 'subtitles']
  if (audioTracks.length > 1) barOrder.push('audio')
  if (levels.length && !qualityFixed) barOrder.push('quality')
  barOrder.push('speed', 'fullscreen')

  const moveBar = (delta: number): void => {
    const index = Math.max(0, barOrder.indexOf(barFocus))
    const next = (index + delta + barOrder.length) % barOrder.length
    setBarFocus(barOrder[next])
    setFocusBar(true)
    poke()
  }

  const moveOption = (delta: number): void => {
    if (!options.length) return
    setOptionFocus((index) => (index + delta + options.length) % options.length)
    poke()
  }

  const activateBar = (): void => {
    switch (barFocus) {
      case 'exit':
        onClose()
        return
      case 'play':
        togglePlay()
        return
      case 'subtitles':
        openPanel('subtitles')
        return
      case 'audio':
        openPanel('audio')
        return
      case 'quality':
        if (!qualityFixed) openPanel('quality')
        return
      case 'speed':
        openPanel('speed')
        return
      case 'fullscreen':
        window.beacon.app.toggleFullscreen()
        return
    }
  }

  const handle = (action: Action): boolean => {
    if (!videoRef.current) return false

    if (action === 'back') {
      if (panel) closePanel()
      else if (scrubFocus) {
        // Step out of scrubbing before hiding the whole overlay.
        setScrubFocus(false)
        setFocusBar(true)
        poke()
      } else if (offer) {
        // The first B is "not this one": the countdown stops and the card goes
        // away, but the player stays. B again falls through to the chrome.
        setUpNextDismissed(true)
      } else if (showControls) {
        setShowControls(false)
        setFocusBar(false)
        window.clearTimeout(hideTimer.current)
      } else onClose()
      return true
    }

    if (panel) {
      switch (action) {
        case 'accept':
          chooseOption(optionFocus)
          return true
        case 'up':
        case 'left':
          moveOption(-1)
          return true
        case 'down':
        case 'right':
          moveOption(1)
          return true
        case 'seekBack':
        case 'seekForward':
        case 'prevSection':
        case 'nextSection':
          jump(action === 'seekBack' || action === 'prevSection' ? -SEEK_JUMP : SEEK_JUMP)
          return true
        case 'menu':
          closePanel()
          return true
        default:
          return true
      }
    }

    switch (action) {
      case 'accept':
        if (scrubFocus) {
          if (scrubJumped.current) playFromScrub()
          else commitScrub()
        } else if (focusBar) {
          activateBar()
          poke()
        } else if (offer) {
          // With the card up, A is "play it now"; B is the way to keep watching.
          playUpNext()
        } else {
          togglePlay()
        }
        return true
      case 'left':
      case 'right':
        if (scrubFocus) nudgeScrub(action === 'left' ? -1 : 1)
        else if (focusBar) moveBar(action === 'left' ? -1 : 1)
        else jump(action === 'left' ? -SEEK_STEP : SEEK_STEP)
        return true
      case 'up':
      case 'down':
        if (scrubFocus) {
          // Down steps back to the control bar; up has nowhere else to go.
          if (action === 'down') {
            setScrubFocus(false)
            setFocusBar(true)
          }
        } else if (action === 'up' && !playing) {
          startScrub()
        } else {
          setFocusBar((focused) => !focused)
        }
        poke()
        return true
      case 'seekBack':
      case 'prevSection':
        if (scrubFocus) jumpScrub(-SEEK_JUMP)
        else jump(-SEEK_JUMP)
        return true
      case 'seekForward':
      case 'nextSection':
        if (scrubFocus) jumpScrub(SEEK_JUMP)
        else jump(SEEK_JUMP)
        return true
      case 'menu':
        setScrubFocus(false)
        setFocusBar(true)
        poke()
        return true
      case 'search':
        openPanel('subtitles')
        return true
      default:
        return false
    }
  }

  useImperativeHandle(ref, () => ({ handle }))

  const percent = duration ? Math.min(100, (current / duration) * 100) : 0
  const scrubbing = scrubFocus && !playing
  const scrubPercent = duration ? Math.min(100, Math.max(0, (scrubAt / duration) * 100)) : 0
  const scrubStart = Math.min(percent, scrubPercent)
  const scrubWidth = Math.abs(scrubPercent - percent)
  const playingLevel = levels.find((level) => level.index === activeLevel)
  const selectedLevel = levels.find((level) => level.index === quality)
  const qualityValue = qualityFixed
    ? `${levelLabel(qualityChoices[0])} (fixed)`
    : quality >= 0
      ? levelLabel(selectedLevel)
      : playingLevel?.height
        ? `Auto ${playingLevel.height}p`
        : 'Auto'
  const captionsOn = captionIndex != null

  const remaining = duration > 0 ? Math.max(0, duration - current) : 0
  const upNextSeconds = Math.ceil(remaining)
  // A menu owns the screen while it is open, and a dismissed card stays gone
  // for the rest of this video (seeking back into the window does not revive it).
  const offer =
    upNext && !upNextDismissed && panel === null && duration > 0 && remaining <= UPNEXT_WINDOW
      ? upNext
      : null

  const focused = (id: BarId): string => (focusBar && barFocus === id ? ' is-focused' : '')

  let panelNote: string | null = null
  if (panel === 'subtitles') {
    if (captionError) panelNote = captionError
    else if (!options.length) panelNote = 'This video has no subtitles.'
  } else if (panel === 'audio') {
    panelNote = 'This stream has one audio track.'
  } else if (panel === 'quality' && qualityFixed) {
    panelNote = 'Quality is fixed for this stream.'
  }

  return (
    <div className="player" onPointerMove={poke}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} className="player__video" playsInline onClick={togglePlay}>
        {captionUrl ? (
          <track
            key={captionUrl}
            data-own="captions"
            kind="subtitles"
            label={caption?.label}
            src={captionUrl}
            default
          />
        ) : null}
      </video>

      {!data && !error ? (
        <div className="player__center">
          <Spinner label="Starting stream" />
        </div>
      ) : null}

      {error ? (
        <div className="player__center">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <div className={`player__chrome${showControls ? ' is-visible' : ''}`}>
        <div className="player__top">
          <h1 className="player__title">{data?.title ?? ''}</h1>
        </div>

        <div className="player__bottom">
          {panel ? (
            <div
              className="player__panel"
              role="menu"
              aria-label={PANEL_TITLES[panel]}
              style={panelPosition ?? undefined}
            >
              <p className="player__panel-title">{PANEL_TITLES[panel]}</p>
              {options.map((option, index) => (
                <button
                  key={option.key}
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.selected}
                  className={`player__option${optionFocus === index ? ' is-focused' : ''}`}
                  tabIndex={-1}
                  onClick={() => chooseOption(index)}
                >
                  <span>{option.label}</span>
                  {option.selected ? (
                    <Check width={20} height={20} strokeWidth={2} aria-hidden />
                  ) : null}
                </button>
              ))}
              {panelNote ? <p className="player__panel-note">{panelNote}</p> : null}
            </div>
          ) : null}

          <div className={`player__progress${scrubbing ? ' is-scrubbing' : ''}`}>
            <div className="player__bar" aria-hidden>
              <div className="player__bar-fill" style={{ width: `${percent}%` }} />
              {scrubbing ? (
                <div
                  className="player__bar-scrub"
                  style={{ left: `${scrubStart}%`, width: `${scrubWidth}%` }}
                />
              ) : null}
            </div>
            {scrubbing ? (
              <span
                className="player__bar-thumb"
                style={{ left: `${scrubPercent}%` }}
                aria-hidden
              />
            ) : null}
            <span
              className={`player__time player__time--current${scrubbing ? ' is-target' : ''}`}
            >
              {formatTime(scrubbing ? scrubAt : current)}
            </span>
            <span className="player__time player__time--total">{formatTime(duration)}</span>
          </div>

          <div className="player__controls">
            <div className="player__group player__group--left">
              <button
                type="button"
                className={`player__control player__control--icon${focused('exit')}`}
                tabIndex={-1}
                aria-label="Back"
                title="Back"
                onClick={() => onClose()}
              >
                <NavArrowLeft width={24} height={24} strokeWidth={1.8} aria-hidden />
              </button>
            </div>

            <div className="player__group player__group--center">
              <button
                type="button"
                className={`player__control player__control--primary${focused('play')}`}
                tabIndex={-1}
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
                onClick={() => {
                  setBarFocus('play')
                  setFocusBar(true)
                  togglePlay()
                }}
              >
                {playing ? (
                  <Pause width={24} height={24} strokeWidth={1.8} aria-hidden />
                ) : (
                  <Play width={24} height={24} strokeWidth={1.8} aria-hidden />
                )}
                <span className="player__control-value">{playing ? 'Pause' : 'Play'}</span>
              </button>
            </div>

            <div className="player__group player__group--right">
              <button
                type="button"
                ref={(element) => {
                  anchorRefs.current.subtitles = element
                }}
                className={`player__control${focused('subtitles')}${captionsOn ? ' is-active' : ''}`}
                tabIndex={-1}
                aria-haspopup="menu"
                aria-expanded={panel === 'subtitles'}
                aria-label={captionsOn ? `Subtitles: ${caption?.label ?? 'on'}` : 'Subtitles: off'}
                title="Subtitles"
                onClick={() => {
                  setBarFocus('subtitles')
                  openPanel('subtitles')
                }}
              >
                <ClosedCaptionsTagSolid
                  width={24}
                  height={24}
                  strokeWidth={1.8}
                  aria-hidden
                />
                <span className="player__control-value">
                  {captionsOn ? (caption?.label ?? 'On') : 'Subtitles'}
                </span>
              </button>

              {audioTracks.length > 1 ? (
                <button
                  type="button"
                  ref={(element) => {
                    anchorRefs.current.audio = element
                  }}
                  className={`player__control player__control--icon${focused('audio')}`}
                  tabIndex={-1}
                  aria-haspopup="menu"
                  aria-expanded={panel === 'audio'}
                  aria-label={`Audio: ${audioTracks[audioTrack] ?? 'default'}`}
                  title={`Audio: ${audioTracks[audioTrack] ?? 'default'}`}
                  onClick={() => {
                    setBarFocus('audio')
                    openPanel('audio')
                  }}
                >
                  <Headset width={24} height={24} strokeWidth={1.8} aria-hidden />
                </button>
              ) : null}

              {levels.length ? (
                <button
                  type="button"
                  ref={(element) => {
                    anchorRefs.current.quality = element
                  }}
                  className={`player__control${focused('quality')}`}
                  tabIndex={-1}
                  disabled={qualityFixed}
                  aria-haspopup={qualityFixed ? undefined : 'menu'}
                  aria-expanded={qualityFixed ? undefined : panel === 'quality'}
                  aria-label={`Quality: ${qualityValue}`}
                  title={qualityFixed ? 'Quality is fixed for this stream' : 'Quality'}
                  onClick={() => {
                    if (qualityFixed) return
                    setBarFocus('quality')
                    openPanel('quality')
                  }}
                >
                  <HdDisplay width={24} height={24} strokeWidth={1.8} aria-hidden />
                  <span className="player__control-value">{qualityValue}</span>
                </button>
              ) : null}

              <button
                type="button"
                ref={(element) => {
                  anchorRefs.current.speed = element
                }}
                className={`player__control${focused('speed')}`}
                tabIndex={-1}
                aria-haspopup="menu"
                aria-expanded={panel === 'speed'}
                aria-label={`Playback speed: ${speedLabel(speed)}`}
                title="Playback speed"
                onClick={() => {
                  setBarFocus('speed')
                  openPanel('speed')
                }}
              >
                <DashboardSpeed width={24} height={24} strokeWidth={1.8} aria-hidden />
                <span className="player__control-value">{speedLabel(speed)}</span>
              </button>

              <button
                type="button"
                className={`player__control player__control--icon${focused('fullscreen')}`}
                tabIndex={-1}
                aria-label="Fullscreen"
                title="Fullscreen"
                onClick={() => {
                  setBarFocus('fullscreen')
                  setFocusBar(true)
                  window.beacon.app.toggleFullscreen()
                }}
              >
                <Maximize width={24} height={24} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>

      {offer ? (
        <div className="player__upnext">
          <button
            type="button"
            className="player__upnext-card"
            tabIndex={-1}
            aria-label={`Play next: ${offer.title}`}
            onClick={playUpNext}
          >
            {offer.image ? <img className="player__upnext-image" src={offer.image} alt="" /> : null}
            <span className="player__upnext-text">
              <span className="player__upnext-label">Up next</span>
              <span className="player__upnext-title">{offer.title}</span>
              <span className="player__upnext-meta">
                {offer.minutes ? `${offer.minutes} min · ` : ''}
                {upNextSeconds > 0 ? `Playing in ${upNextSeconds}s` : 'Playing now'}
              </span>
            </span>
          </button>
          <div className="player__upnext-timer" aria-hidden>
            <div
              className="player__upnext-fill"
              style={{ width: `${(remaining / UPNEXT_WINDOW) * 100}%` }}
            />
          </div>
          <button
            type="button"
            className="player__upnext-cancel"
            tabIndex={-1}
            onClick={() => setUpNextDismissed(true)}
          >
            Keep watching
          </button>
        </div>
      ) : null}
    </div>
  )
}
