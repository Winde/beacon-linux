import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ClosedCaptionsTagSolid,
  DashboardSpeed,
  HdDisplay,
  Headset,
  Maximize,
  NavArrowLeft,
  Pause,
  Play
} from 'iconoir-react'
import type { NextEpisode } from '@shared/types'
import type { Action } from '../input/useInput'
import { ErrorNote, Spinner } from '../components/ui'
import {
  CONTROLS_TIMEOUT,
  SEEK_JUMP,
  SEEK_STEP,
  SPEEDS,
  UPNEXT_WINDOW,
  SCRUB_ACCELERATION,
  SCRUB_HOLD_GAP,
  SCRUB_MAX_CEILING,
  SCRUB_MIN_CEILING,
  formatTime,
  levelLabel,
  speedLabel,
  type BarId,
  type MenuOption,
  type Panel
} from '../player/model'
import { PlayerPanel } from '../player/PlayerPanel'
import { UpNextCard } from '../player/UpNextCard'
import { useMediaSession } from '../player/useMediaSession'

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

export function Player({
  slug,
  startAt,
  onClose,
  onPlayNext,
  ref
}: PlayerProps): React.JSX.Element {
  const {
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
  } = useMediaSession({ slug, startAt })

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const anchorRefs = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const hideTimer = useRef<number | undefined>(undefined)
  const panelRef = useRef(false)
  const scrubMotion = useRef({ direction: 0, at: 0, step: 0 })
  const scrubJumped = useRef(false)

  const [showControls, setShowControls] = useState(true)
  const [focusBar, setFocusBar] = useState(false)
  const [barFocus, setBarFocus] = useState<BarId>('play')
  const [scrubFocus, setScrubFocus] = useState(false)
  const [scrubAt, setScrubAt] = useState(0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [panelPosition, setPanelPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [optionFocus, setOptionFocus] = useState(0)

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

  // Ask for the next episode once the stream is known. One small query runs
  // alongside playback, so the card is ready long before the ending and a
  // failure costs nothing: the video simply ends where it ends.
  useEffect(() => {
    if (!data?.collection?.isSeries) return
    let cancelled = false
    window.beacon.playback
      .next({
        contentId: data.id,
        collectionId: data.collection.id,
        isSeries: data.collection.isSeries
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
  // the remaining time, the element's own `ended` is the trigger. A series the
  // editor marked autoplay-disabled keeps the card, but waits for a click.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = (): void => {
      if (upNext && !upNextDismissed && !upNext.autoplayDisabled) onPlayNext(upNext.slug)
    }
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [upNext, upNextDismissed, onPlayNext, videoRef])

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
    scrubMotion.current = { direction: 0, at: 0, step: 0 }
    seekTo(scrubAt)
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

  const audioOnly = data?.kind === 'audio'

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

  const barOrder: BarId[] = ['exit', 'play']
  if (!audioOnly) barOrder.push('subtitles')
  if (!audioOnly && audioTracks.length > 1) barOrder.push('audio')
  if (!audioOnly && levels.length && !qualityFixed) barOrder.push('quality')
  barOrder.push('speed')
  if (!audioOnly) barOrder.push('fullscreen')

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
      {/* The caption track below is added only when the member picks one. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        className={`player__video${audioOnly ? ' player__video--audio' : ''}`}
        playsInline
        onClick={togglePlay}
      >
        {captionUrl ? (
          <track
            key={captionUrl}
            data-own="captions"
            kind="subtitles"
            label={caption?.label}
            src={captionUrl}
          />
        ) : null}
      </video>

      {audioOnly ? (
        <div className="player__audio" data-testid="audio-player">
          <div className="player__audio-art">
            {data?.image ? (
              <img src={data.image} alt="" draggable={false} />
            ) : (
              <div className="player__audio-art-empty" aria-hidden />
            )}
          </div>
          <div className="player__audio-meta">
            <span className="player__audio-kicker">Beacon podcast</span>
            <h2 className="player__audio-title">{data?.title}</h2>
          </div>
        </div>
      ) : null}

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

      <div
        className={`player__chrome${showControls ? ' is-visible' : ''}${audioOnly ? ' player__chrome--audio' : ''}`}
      >
        {!audioOnly ? (
          <div className="player__top">
            <h1 className="player__title">
              {data?.title ?? ''}
              {data?.live ? <span className="player__live">Live</span> : null}
            </h1>
          </div>
        ) : null}

        <div className="player__bottom">
          {panel ? (
            <PlayerPanel
              panel={panel}
              position={panelPosition}
              options={options}
              optionFocus={optionFocus}
              optionRefs={optionRefs}
              note={panelNote}
              onChoose={chooseOption}
            />
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
            <span className={`player__time player__time--current${scrubbing ? ' is-target' : ''}`}>
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
              {!audioOnly ? (
                <button
                  type="button"
                  ref={(element) => {
                    anchorRefs.current.subtitles = element
                  }}
                  className={`player__control${focused('subtitles')}${captionsOn ? ' is-active' : ''}`}
                  tabIndex={-1}
                  aria-haspopup="menu"
                  aria-expanded={panel === 'subtitles'}
                  aria-label={
                    captionsOn ? `Subtitles: ${caption?.label ?? 'on'}` : 'Subtitles: off'
                  }
                  title="Subtitles"
                  onClick={() => {
                    setBarFocus('subtitles')
                    openPanel('subtitles')
                  }}
                >
                  <ClosedCaptionsTagSolid width={24} height={24} strokeWidth={1.8} aria-hidden />
                  <span className="player__control-value">
                    {captionsOn ? (caption?.label ?? 'On') : 'Subtitles'}
                  </span>
                </button>
              ) : null}

              {!audioOnly && audioTracks.length > 1 ? (
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

              {!audioOnly && levels.length ? (
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

              {!audioOnly ? (
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
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {offer ? (
        <UpNextCard
          offer={offer}
          remaining={remaining}
          onPlay={playUpNext}
          onDismiss={() => setUpNextDismissed(true)}
        />
      ) : null}
    </div>
  )
}
