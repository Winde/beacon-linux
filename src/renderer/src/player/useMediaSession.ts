import { useCallback, useEffect, useRef, useState } from 'react'
import type HlsPlayer from 'hls.js'
import type { CaptionTrack, PlaybackData } from '@shared/types'
import { cleanError } from '../lib/errors'
import { REPORT_STEP, SUBTITLE_KEY, type QualityLevel } from './model'

export interface MediaSession {
  videoRef: React.RefObject<HTMLVideoElement | null>
  data: PlaybackData | null
  error: string | null
  playing: boolean
  current: number
  duration: number
  levels: QualityLevel[]
  quality: number
  activeLevel: number
  audioTracks: string[]
  audioTrack: number
  speed: number
  captionIndex: number | null
  captionUrl: string | null
  captionError: string | null
  caption: CaptionTrack | undefined
  chooseCaptions(index: number | null): void
  chooseQuality(index: number): void
  chooseAudio(index: number): void
  chooseSpeed(value: number): void
  seekTo(seconds: number): void
}

interface MediaSessionOptions {
  slug: string
  startAt?: number
}

/**
 * Everything that touches the video element: opening the stream, attaching
 * hls.js, mirroring playback state, captions, quality/audio tracks, and the
 * progress reports. The controls and their state machine stay in the player.
 */
export function useMediaSession({ slug, startAt }: MediaSessionOptions): MediaSession {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsPlayer | null>(null)
  const blobRef = useRef<string | null>(null)
  const captionCache = useRef(new Map<string, string>())
  const lastRef = useRef({ position: 0, duration: 0 })
  const lastQueued = useRef(-1)
  const contentRef = useRef<string | null>(null)
  const startedRef = useRef<string | null>(null)

  const [data, setData] = useState<PlaybackData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  const [captionIndex, setCaptionIndex] = useState<number | null>(null)
  const [captionUrl, setCaptionUrl] = useState<string | null>(null)
  const [captionError, setCaptionError] = useState<string | null>(null)

  const [levels, setLevels] = useState<QualityLevel[]>([])
  const [quality, setQuality] = useState(-1)
  const [activeLevel, setActiveLevel] = useState(-1)
  const [audioTracks, setAudioTracks] = useState<string[]>([])
  const [audioTrack, setAudioTrack] = useState(0)
  const [speed, setSpeed] = useState(1)

  /**
   * Hand the main process a position worth sending. The queue there does the
   * deduplicating and batching; this only decides when playback has moved far
   * enough to be worth a new event. The first report after a new episode goes
   * out at once, as the app's tracker does.
   */
  const queueProgress = useCallback((force = false): void => {
    const contentId = contentRef.current
    const { position, duration: total } = lastRef.current
    if (!contentId || !total || position < 1) return
    if (
      !force &&
      lastQueued.current >= 0 &&
      Math.abs(position - lastQueued.current) < REPORT_STEP
    ) {
      return
    }
    lastQueued.current = position
    void window.beacon.playback.progress({ contentId, position, duration: total })
  }, [])

  // Tell Beacon a view has started, reset the position gate for a new episode,
  // and hand over the last position when this one closes.
  useEffect(() => {
    contentRef.current = data?.id ?? null
    lastQueued.current = -1
    lastRef.current = { position: 0, duration: 0 }
    if (!data) return
    // StrictMode runs effects twice in development; a view is started once.
    if (startedRef.current !== data.id) {
      startedRef.current = data.id
      void window.beacon.playback.start(data.id).catch(() => false)
    }
    return () => {
      queueProgress(true)
      void window.beacon.playback.flush().catch(() => false)
      contentRef.current = null
    }
  }, [data, queueProgress])

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
          // Beacon's captions are fetched as a separate VTT file and drawn by
          // the renderer. hls.js must not create or draw its own text tracks:
          // the stream can carry both an EXT-X-MEDIA subtitle track and in-band
          // CEA captions, and either one paints every cue a second time.
          // `subtitleDisplay = false` is not enough; hls.js can flip it back
          // when it selects a default subtitle track. Turning off native text
          // tracks is the only reliable way to keep our fetched track alone.
          const hls = new Hls({
            enableWorker: true,
            renderTextTracksNatively: false,
            enableCEA708Captions: false
          })
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
              hls.audioTracks.map(
                (track, index) => track.name || track.lang || `Track ${index + 1}`
              )
            )
            setAudioTrack(hls.audioTrack >= 0 ? hls.audioTrack : 0)
          }

          hls.loadSource(source)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            // We use JW's caption file; hls.js has nothing to select or load.
            hls.subtitleTrack = -1
            syncTracks()
          })
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

  // Mirror the element's state into React for the overlay.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = (): void => {
      setCurrent(video.currentTime)
      lastRef.current.position = video.currentTime
      queueProgress()
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
  }, [queueProgress])

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
    const cache = captionCache.current
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
    }
  }, [])

  const caption = captionIndex == null ? undefined : data?.captions[captionIndex]

  useEffect(() => {
    const video = videoRef.current
    if (!video?.textTracks) return

    // Show only the externally fetched track. hls.js may add a native subtitle
    // track after this effect first runs (or after the manifest is parsed), so
    // re-apply the modes on every add/remove as well as on a caption change.
    const sync = (): void => {
      if (!video.textTracks) return
      const own = video.querySelector<HTMLTrackElement>('track[data-own="captions"]')?.track ?? null
      for (const track of Array.from(video.textTracks)) {
        const mode = captionUrl && track === own ? 'showing' : 'disabled'
        if (track.mode !== mode) track.mode = mode
      }
    }

    sync()
    const tracks = video.textTracks
    tracks.addEventListener?.('addtrack', sync)
    tracks.addEventListener?.('removetrack', sync)
    return () => {
      tracks.removeEventListener?.('addtrack', sync)
      tracks.removeEventListener?.('removetrack', sync)
    }
  }, [captionUrl, caption])

  const chooseCaptions = useCallback(
    (index: number | null): void => {
      setCaptionIndex(index)
      try {
        if (index == null) window.localStorage.removeItem(SUBTITLE_KEY)
        else window.localStorage.setItem(SUBTITLE_KEY, data?.captions[index]?.label ?? '')
      } catch {
        // Preference is a convenience; playback does not depend on it.
      }
    },
    [data]
  )

  const chooseQuality = useCallback((index: number): void => {
    const hls = hlsRef.current
    if (!hls) return
    hls.currentLevel = index
    setQuality(index)
  }, [])

  const chooseAudio = useCallback((index: number): void => {
    const hls = hlsRef.current
    if (!hls) return
    hls.audioTrack = index
    setAudioTrack(index)
  }, [])

  const chooseSpeed = useCallback((value: number): void => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = value
    setSpeed(value)
  }, [])

  const seekTo = useCallback((seconds: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = seconds
    setCurrent(seconds)
    lastRef.current.position = seconds
  }, [])

  return {
    videoRef,
    data,
    error,
    playing,
    current,
    duration,
    levels,
    quality,
    activeLevel,
    audioTracks,
    audioTrack,
    speed,
    captionIndex,
    captionUrl,
    captionError,
    caption,
    chooseCaptions,
    chooseQuality,
    chooseAudio,
    chooseSpeed,
    seekTo
  }
}
