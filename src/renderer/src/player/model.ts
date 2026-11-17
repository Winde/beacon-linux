/** Shared player constants, types and small formatters. */

export type Panel = 'subtitles' | 'audio' | 'quality' | 'speed'
export type BarId = 'exit' | 'play' | 'subtitles' | 'audio' | 'quality' | 'speed' | 'fullscreen'

export interface QualityLevel {
  /** Index into hls.levels. */
  index: number
  height: number | null
  bitrate: number
}

export interface MenuOption {
  key: string
  label: string
  selected: boolean
  run: () => void
}

export const CONTROLS_TIMEOUT = 4000
export const SEEK_STEP = 10
export const SEEK_JUMP = 60
export const SCRUB_HOLD_GAP = 350
export const SCRUB_ACCELERATION = 1.5
export const SCRUB_MIN_CEILING = 30
export const SCRUB_MAX_CEILING = 120
/** The app queues a position after this much playback has moved, not on a timer. */
export const REPORT_STEP = 10
export const SUBTITLE_KEY = 'beacon.player.subtitles'
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
/**
 * How long the "up next" card sits over the ending. Fifteen seconds is the
 * television default Plex landed on; Netflix's five is the aggressive end of
 * the range and reads as a grab. Long credits are the reason there is a window
 * at all, and B is this player's "watch the credits".
 */
export const UPNEXT_WINDOW = 15

export const PANEL_TITLES: Record<Panel, string> = {
  subtitles: 'Subtitles',
  audio: 'Audio',
  quality: 'Quality',
  speed: 'Playback speed'
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function levelLabel(level: QualityLevel | undefined): string {
  if (!level) return 'Auto'
  if (level.height) return `${level.height}p`
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`
  return 'Level'
}

export function speedLabel(speed: number): string {
  return `${speed}×`
}
