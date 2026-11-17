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
/** A horizontal strip of items, e.g. a shelf, a grid line, or a button row. */
const ROW = '[data-focus-row]'

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

/**
 * Focusable elements, optionally only those inside `scope`. An overlay passes
 * its own container so the screen underneath cannot win a move.
 */
function candidates(scope?: ParentNode): HTMLElement[] {
  const root = scope ?? document
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // `inert` subtrees stay mounted for their exit animation (the closed rail
    // slides out), but must never take focus. A disabled control has the same
    // problem: it cannot receive real focus, so the highlight would park there
    // and `accept` would do nothing.
    (element) => !element.closest('[inert]') && !element.matches(':disabled') && isVisible(element)
  )
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * Bounding box in layout space: the scroll offsets of every ancestor are
 * added back in, so scrolling does not change the geometry navigation sees.
 *
 * Without this, a shelf scrolled up under a pinned header is physically far
 * above the current tile, which makes the header's Play button the nearest
 * candidate for "up". Focus then jumps straight back to the hero instead of
 * walking up the rows in order.
 */
function layoutBox(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  let left = rect.left
  let top = rect.top
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    left += parent.scrollLeft
    top += parent.scrollTop
  }
  return {
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    width: rect.width,
    height: rect.height
  }
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
export function focusFirst(prefer?: string, scope?: ParentNode): void {
  const all = candidates(scope)
  const preferred = prefer ? all.find((el) => el.matches(prefer)) : undefined
  setFocused(preferred ?? all[0] ?? null)
}

function pick(from: HTMLElement, pool: HTMLElement[], direction: Direction): HTMLElement | null {
  const a = layoutBox(from)
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  const horizontal = direction === 'left' || direction === 'right'

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const element of pool) {
    if (element === from) continue
    const b = layoutBox(element)
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

    // A horizontal press never leaves its row. Drifting diagonally to whatever
    // sits near the old column is how focus used to land in the middle of the
    // next shelf; the row-end wrap handles that from its beginning instead.
    if (horizontal && !aligned) continue

    const score = primary + (aligned ? secondary * 0.2 : secondary * 3)
    if (score < bestScore) {
      bestScore = score
      best = element
    }
  }

  return best
}

/**
 * The first item of the next row down.
 *
 * A row ends where its last item ends: pressing right there continues on the
 * next row, entered from its beginning. Keeping the old column instead lands
 * the viewer in the middle of a row that is shorter or scrolled, so the next
 * row band is read left to right.
 *
 * Only items inside a `data-focus-row` take part. A vertical stack of form
 * fields is not a row, and a right press at the end of one must stay inert.
 */
function firstOfNextRow(from: HTMLElement, pool: HTMLElement[]): HTMLElement | null {
  if (!from.closest(ROW)) return null
  const a = layoutBox(from)

  let nearest: Box | null = null
  const below: { element: HTMLElement; box: Box }[] = []
  for (const element of pool) {
    if (element === from || !element.closest(ROW)) continue
    const box = layoutBox(element)
    // A row below starts under this item. Comparing tops, not centres, keeps
    // a taller neighbour in the same row from reading as the next row.
    if (box.top < a.bottom) continue
    below.push({ element, box })
    if (!nearest || box.top + box.height / 2 < nearest.top + nearest.height / 2) {
      nearest = box
    }
  }
  if (!nearest) return null

  let first: HTMLElement | null = null
  let firstLeft = Infinity
  for (const { element, box } of below) {
    // The nearest band, not a row further down: overlap is what "same row"
    // means, and it tolerates tall and short items in one band.
    const overlap = Math.min(nearest.bottom, box.bottom) - Math.max(nearest.top, box.top)
    if (overlap <= Math.min(nearest.height, box.height) * 0.6) continue
    if (box.left < firstLeft) {
      firstLeft = box.left
      first = element
    }
  }
  return first
}

/**
 * Move focus in a direction. Returns false when the edge of the screen was reached.
 *
 * `scope` confines the move to a container. The rail needs that: its Sign out
 * sits at the foot of the screen, so the rows behind it are geometrically
 * nearer to Search and would otherwise take the "down" press.
 */
export function move(direction: Direction, scope?: ParentNode): boolean {
  if (!current || !current.isConnected) {
    focusFirst(undefined, scope)
    return true
  }
  const pool = candidates(scope)
  const next = pick(current, pool, direction)
  if (next) {
    setFocused(next)
    return true
  }
  // Right at the end of a row carries on to the row below, from its start.
  // Left at the start is left alone: it is the gesture that opens the rail.
  const wrap = direction === 'right' ? firstOfNextRow(current, pool) : null
  if (!wrap) return false
  setFocused(wrap)
  return true
}

/** Keep focus inside a subtree, e.g. a dialog. */
export function focusWithin(container: HTMLElement): void {
  const first = container.querySelector<HTMLElement>(FOCUSABLE)
  if (first) setFocused(first)
}
