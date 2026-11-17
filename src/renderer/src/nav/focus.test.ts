// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusFirst, focusWithin, getFocused, move, onFocusChange, setFocused } from './focus'

interface TileOptions {
  width?: number
  height?: number
  focusable?: boolean
}

/** A focusable element with a fixed box, since jsdom reports every box as empty. */
function tile(left: number, top: number, options: TileOptions = {}): HTMLElement {
  const element = document.createElement('button')
  element.dataset.focus = options.focusable === false ? 'false' : ''
  const rect = new DOMRect(left, top, options.width ?? 100, options.height ?? 60)
  element.getBoundingClientRect = () => rect
  element.scrollIntoView = vi.fn()
  document.body.append(element)
  return element
}

/** Two rows of three tiles, 220 wide and 160 apart. */
function grid(): HTMLElement[] {
  const tiles: HTMLElement[] = []
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) tiles.push(tile(col * 220, row * 160))
  }
  return tiles
}

/** A marked strip of tiles: navigation treats its edge as the end of a row. */
function strip(...tiles: HTMLElement[]): HTMLElement {
  const element = document.createElement('div')
  element.dataset.focusRow = ''
  element.append(...tiles)
  document.body.append(element)
  return element
}

/** One shelf of `count` tiles, 220 apart, starting at `left`. */
function shelf(top: number, count = 3, left = 0): HTMLElement[] {
  const tiles: HTMLElement[] = []
  for (let col = 0; col < count; col++) tiles.push(tile(left + col * 220, top))
  strip(...tiles)
  return tiles
}

beforeEach(() => {
  setFocused(null)
  document.body.innerHTML = ''
})

describe('setFocused', () => {
  it('marks the focused element and clears the previous one', () => {
    const [a, b] = grid()

    setFocused(a)
    expect(a.classList.contains('is-focused')).toBe(true)
    expect(a.dataset.focused).toBe('true')

    setFocused(b)
    expect(getFocused()).toBe(b)
    expect(a.classList.contains('is-focused')).toBe(false)
    expect(a.hasAttribute('data-focused')).toBe(false)
    expect(b.classList.contains('is-focused')).toBe(true)
  })

  it('scrolls the new element into view unless told not to', () => {
    const [a] = grid()

    setFocused(a, false)
    expect(a.scrollIntoView).not.toHaveBeenCalled()

    setFocused(null, false)
    setFocused(a)
    expect(a.scrollIntoView).toHaveBeenCalled()
  })

  it('clears focus with null', () => {
    const [a] = grid()
    setFocused(a)

    setFocused(null)

    expect(getFocused()).toBeNull()
    expect(a.classList.contains('is-focused')).toBe(false)
  })
})

describe('onFocusChange', () => {
  it('reports changes until the listener unsubscribes', () => {
    const [a, b] = grid()
    const seen: (HTMLElement | null)[] = []
    const off = onFocusChange((element) => seen.push(element))

    setFocused(a)
    setFocused(a)
    setFocused(b)
    off()
    setFocused(null)

    expect(seen).toEqual([a, b])
  })
})

describe('focusFirst', () => {
  it('focuses the first focusable element', () => {
    const [first] = grid()
    focusFirst()
    expect(getFocused()).toBe(first)
  })

  it('prefers an element matching the selector', () => {
    const tiles = grid()
    tiles[4].dataset.focus = 'hero'

    focusFirst('[data-focus="hero"]')

    expect(getFocused()).toBe(tiles[4])
  })

  it('does nothing when the screen has no focusable element', () => {
    tile(0, 0, { focusable: false })
    focusFirst()
    expect(getFocused()).toBeNull()
  })
})

describe('move', () => {
  it('moves one tile in each direction', () => {
    const tiles = grid()
    setFocused(tiles[1])

    expect(move('down')).toBe(true)
    expect(getFocused()).toBe(tiles[4])

    expect(move('up')).toBe(true)
    expect(getFocused()).toBe(tiles[1])

    expect(move('left')).toBe(true)
    expect(getFocused()).toBe(tiles[0])

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(tiles[1])
  })

  it('reports false when it reaches the edge', () => {
    const [first] = grid()
    setFocused(first)

    expect(move('left')).toBe(false)
    expect(move('up')).toBe(false)
    expect(getFocused()).toBe(first)
  })

  it('starts from the first tile when nothing is focused', () => {
    const [first] = grid()
    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(first)
  })

  it('recovers when the focused element has left the document', () => {
    const [first, second] = grid()
    setFocused(first)
    first.remove()

    expect(move('down')).toBe(true)
    expect(getFocused()).toBe(second)
  })

  it('skips hidden elements', () => {
    const [a, b, c] = grid()
    b.style.visibility = 'hidden'
    setFocused(a)

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(c)
  })

  it('skips elements that opt out of focus', () => {
    const [a, b, c] = grid()
    b.dataset.focus = 'false'
    setFocused(a)

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(c)
  })

  it('skips a disabled control, which cannot take real focus', () => {
    const [a, b, c] = grid() as HTMLButtonElement[]
    b.disabled = true
    setFocused(a)

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(c)
  })

  it('does not park the first focus on a disabled control', () => {
    const [a, b] = grid() as HTMLButtonElement[]
    a.disabled = true

    focusFirst()

    expect(getFocused()).toBe(b)
  })

  it('skips elements with no box', () => {
    const [a] = grid()
    const collapsed = tile(220, 0, { width: 0, height: 0 })
    setFocused(a)

    expect(move('right')).toBe(true)
    expect(getFocused()).not.toBe(collapsed)
  })

  it('does not leave a row while it still has an item to the right', () => {
    const first = shelf(0)
    shelf(160)

    setFocused(first[1])
    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(first[2])
  })

  it('continues on the next row from its first item when a row ends', () => {
    const first = shelf(0)
    const next = shelf(160)

    setFocused(first[2])

    // The old column is the next row's last item; the row is entered at its start.
    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(next[0])
    expect(getFocused()).not.toBe(next[2])
  })

  it('does not mistake a taller item in the same row for the next row', () => {
    // Unstretched tiles: the tall first item's centre sits below the current
    // item's centre, but it still belongs to the row that just ended.
    const tall = tile(0, -60, { height: 200 })
    const from = tile(220, 0, { height: 60 })
    const next = shelf(260)
    strip(tall, from)

    setFocused(from)

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(next[0])
    expect(getFocused()).not.toBe(tall)
  })

  it('wraps inside a grid to the first item of the next line', () => {
    const tiles: HTMLElement[] = []
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) tiles.push(tile(col * 220, row * 160))
    }
    strip(...tiles)
    setFocused(tiles[2])

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(tiles[3])
  })

  it('enters a scrolled row from its beginning, not its first visible item', () => {
    const first = shelf(0)
    const scroller = document.createElement('div')
    scroller.scrollLeft = 440
    scroller.dataset.focusRow = ''
    document.body.append(scroller)
    // The viewport rects show this row scrolled two tiles in; layout space
    // still knows which tile comes first.
    const offscreen = tile(-440, 160)
    const middle = tile(-220, 160)
    scroller.append(offscreen, middle)

    setFocused(first[2])

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(offscreen)
    expect(getFocused()).not.toBe(middle)
  })

  it('does not wrap out of a stack that is not a row', () => {
    const email = tile(0, 0, { width: 400 })
    const password = tile(0, 80, { width: 400 })
    setFocused(email)

    expect(move('right')).toBe(false)
    expect(getFocused()).toBe(email)
    expect(getFocused()).not.toBe(password)
  })

  it('stays inside the given scope', () => {
    const rail = document.createElement('nav')
    document.body.append(rail)
    // Search at the top of the rail, Sign out at its foot.
    const search = tile(16, 0)
    const signOut = tile(16, 600)
    rail.append(search, signOut)
    // A content row behind the rail is nearer to Search than Sign out is.
    const behind = tile(56, 80)
    setFocused(search)

    expect(move('down', rail)).toBe(true)
    expect(getFocused()).toBe(signOut)
    expect(getFocused()).not.toBe(behind)
  })

  it('skips elements inside an inert container', () => {
    const [a, b, c] = grid()
    const closedRail = document.createElement('nav')
    closedRail.setAttribute('inert', '')
    document.body.append(closedRail)
    closedRail.append(b)
    setFocused(a)

    expect(move('right')).toBe(true)
    expect(getFocused()).toBe(c)
  })

  it('measures in layout space so a scrolled shelf stays in order', () => {
    const scroller = document.createElement('div')
    scroller.scrollTop = 5000
    document.body.append(scroller)

    // The shelf sits 5000px up its own scroll container, so its viewport rect is
    // far above the page; the pinned header is closer on screen.
    const shelf = tile(0, -4900)
    scroller.append(shelf)
    const header = tile(0, 0)
    const current = tile(0, 800)
    setFocused(current)

    expect(move('up')).toBe(true)
    expect(getFocused()).toBe(shelf)
    expect(getFocused()).not.toBe(header)
  })
})

describe('focusWithin', () => {
  it('focuses the first focusable element in a container', () => {
    const [outside] = grid()
    const dialog = document.createElement('div')
    const inside = document.createElement('button')
    inside.dataset.focus = ''
    inside.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10)
    inside.scrollIntoView = vi.fn()
    dialog.append(inside)
    document.body.append(dialog)
    setFocused(outside)

    focusWithin(dialog)

    expect(getFocused()).toBe(inside)
  })

  it('keeps the current focus when the container is empty', () => {
    const [outside] = grid()
    const dialog = document.createElement('div')
    document.body.append(dialog)
    setFocused(outside)

    focusWithin(dialog)

    expect(getFocused()).toBe(outside)
  })
})
