/**
 * Spatial focus navigation for a remote or a gamepad.
 *
 * Focus is tracked on the DOM rather than in React state: moving focus is the
 * hottest interaction in a TV app, and a class toggle keeps it at one repaint
 * instead of re-rendering every tile on screen.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

type Listener = (element: HTMLElement | null) => void

const FOCUSABLE = '[data-focus]:not([data-focus="false"])'
const FOCUS_CLASS = 'is-focused'

let current: HTMLElement | null = null
const listeners = new Set<Listener>()

export function getFocused(): HTMLElement | null {
  return current
}

export function onFocusChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
}

function candidates(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
}

export function setFocused(element: HTMLElement | null, scroll = true): void {
  if (element === current) return
  current?.classList.remove(FOCUS_CLASS)
  current?.removeAttribute('data-focused')
  current = element
  if (current) {
    current.classList.add(FOCUS_CLASS)
    current.setAttribute('data-focused', 'true')
    // Real DOM focus keeps accessibility and lets components use onFocus.
    current.focus({ preventScroll: true })
    if (scroll) current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  for (const listener of listeners) listener(current)
}

/** Focus the first focusable element, or the one matching `prefer`. */
export function focusFirst(prefer?: string): void {
  const all = candidates()
  const preferred = prefer ? all.find((el) => el.matches(prefer)) : undefined
  setFocused(preferred ?? all[0] ?? null)
}

function pick(from: HTMLElement, pool: HTMLElement[], direction: Direction): HTMLElement | null {
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  const horizontal = direction === 'left' || direction === 'right'

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const element of pool) {
    if (element === from) continue
    const b = element.getBoundingClientRect()
    const dx = b.left + b.width / 2 - ax
    const dy = b.top + b.height / 2 - ay

    const primary =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    if (primary <= 1) continue

    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx)

    // Overlap on the perpendicular axis means "same row" / "same column".
    const overlap = horizontal
      ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      : Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const thickness = horizontal ? Math.min(a.height, b.height) : Math.min(a.width, b.width)
    const aligned = overlap > thickness * 0.6

    // Never drift diagonally between rows just because a row ended.
    if (horizontal && !aligned && secondary > primary) continue

    const score = primary + (aligned ? secondary * 0.2 : secondary * 3)
    if (score < bestScore) {
      bestScore = score
      best = element
    }
  }

  return best
}

/** Move focus in a direction. Returns false when the edge of the screen was reached. */
export function move(direction: Direction): boolean {
  if (!current || !current.isConnected) {
    focusFirst()
    return true
  }
  const next = pick(current, candidates(), direction)
  if (!next) return false
  setFocused(next)
  return true
}

/** Keep focus inside a subtree, e.g. a dialog. */
export function focusWithin(container: HTMLElement): void {
  const first = container.querySelector<HTMLElement>(FOCUSABLE)
  if (first) setFocused(first)
}
