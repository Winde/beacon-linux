import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { PlaybackData } from '@shared/types'
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
  ref?: React.Ref<PlayerHandle>
}

const CONTROLS_TIMEOUT = 4000
const SEEK_STEP = 10
const SEEK_JUMP = 60
const REPORT_EVERY = 15000

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function Player({ slug, startAt, onClose, ref }: PlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const blobRef = useRef<string | null>(null)
  const lastRef = useRef({ position: 0, duration: 0 })
  const hideTimer = useRef<number | undefined>(undefined)

  const [data, setData] = useState<PlaybackData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [captionUrl, setCaptionUrl] = useState<string | null>(null)

  const poke = useCallback(() => {
    setShowControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowControls(false), CONTROLS_TIMEOUT)
  }, [])

  // Load the stream and attach it to the video element.
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)

    window.beacon.playback
      .open(slug)
      .then((playback) => {
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

        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true })
          hls.loadSource(source)
          hls.attachMedia(video)
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
    }
    const onDuration = (): void => {
      const value = Number.isFinite(video.duration) ? video.duration : 0
      setDuration(value)
      lastRef.current.duration = value
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
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

  // Subtitles: JW Player's caption host sends no CORS headers, so the main
  // process fetches the file and we hand the player a local blob.
  useEffect(() => {
    if (!captionsOn || !data?.captions.length) {
      setCaptionUrl(null)
      return
    }
    let cancelled = false
    let created: string | null = null
    window.beacon.playback
      .captions(data.captions[0].url)
      .then((text) => {
        if (cancelled) return
        created = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
        setCaptionUrl(created)
      })
      .catch(() => {
        if (!cancelled) setError('Subtitles could not be loaded.')
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [captionsOn, data])

  useEffect(() => {
    const video = videoRef.current
    const track = video?.textTracks[0]
    if (track) track.mode = captionUrl ? 'showing' : 'disabled'
  }, [captionUrl])

  useEffect(() => {
    if (playing) poke()
  }, [playing, poke])

  useEffect(() => {
    return () => window.clearTimeout(hideTimer.current)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      handle(action: Action): boolean {
        const video = videoRef.current
        if (!video) return false
        poke()
        switch (action) {
          case 'accept':
            if (video.paused) void video.play().catch(() => {})
            else video.pause()
            return true
          case 'up':
          case 'down':
            return true
          case 'left':
            video.currentTime = Math.max(0, video.currentTime - SEEK_STEP)
            return true
          case 'right':
            video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_STEP)
            return true
          case 'seekBack':
          case 'prevSection':
            video.currentTime = Math.max(0, video.currentTime - SEEK_JUMP)
            return true
          case 'seekForward':
          case 'nextSection':
            video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_JUMP)
            return true
          case 'search':
            setCaptionsOn((value) => !value)
            return true
          case 'back':
            onClose()
            return true
          default:
            return false
        }
      }
    }),
    [onClose, poke]
  )

  const percent = duration ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className="player">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} className="player__video" playsInline>
        {captionUrl ? <track key={captionUrl} kind="subtitles" src={captionUrl} default /> : null}
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

      <div className={`player__chrome${showControls || !playing ? ' is-visible' : ''}`}>
        <div className="player__top">
          <h1 className="player__title">{data?.title ?? ''}</h1>
        </div>
        <div className="player__bottom">
          <div className="player__bar">
            <div className="player__bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="player__meta">
            <span>{formatTime(current)}</span>
            <span className="player__hint">
              A play/pause · ←→ 10s · LT/RT 1min · X subtitles · B back
            </span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
