// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInput, type Action } from './useInput'

// React 19 only collects act() warnings when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ onAction }: { onAction: (action: Action) => void }): null {
  useInput(onAction)
  return null
}

let root: Root
let container: HTMLDivElement
let mounted: boolean
let frames: FrameRequestCallback[]
let pads: (Gamepad | null)[]

function render(onAction: (action: Action) => void): void {
  act(() => {
    root.render(createElement(Harness, { onAction }))
  })
}

function unmount(): void {
  if (!mounted) return
  mounted = false
  act(() => root.unmount())
}

/** Run the pending animation frame, which queues the next one. */
function flushFrame(): void {
  const pending = frames
  frames = []
  act(() => {
    for (const callback of pending) callback(performance.now())
  })
}

function key(keyName: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: keyName,
    bubbles: true,
    cancelable: true
  })
  target.dispatchEvent(event)
  return event
}

function gamepad(overrides: { id?: string; pressed?: number[]; axes?: number[] } = {}): Gamepad {
  const pressed = new Set(overrides.pressed ?? [])
  return {
    id: overrides.id ?? 'Xbox Wireless Controller',
    connected: true,
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: pressed.has(index),
      touched: pressed.has(index),
      value: pressed.has(index) ? 1 : 0
    }))
  } as unknown as Gamepad
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mounted = true
  frames = []
  pads = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('navigator', { getGamepads: () => pads })
})

afterEach(() => {
  unmount()
  container.remove()
  vi.unstubAllGlobals()
})

describe('keyboard', () => {
  it('maps every supported key to an action', () => {
    const cases: [string, Action][] = [
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['ArrowLeft', 'left'],
      ['ArrowRight', 'right'],
      ['Enter', 'accept'],
      [' ', 'accept'],
      ['Escape', 'back'],
      ['Backspace', 'back'],
      ['m', 'menu'],
      ['/', 'search']
    ]
    const actions: Action[] = []
    render((action) => actions.push(action))

    for (const [pressed] of cases) key(pressed)

    expect(actions).toEqual(cases.map(([, action]) => action))
  })

  it('leaves the letter x for typing and opens search only from /', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    key('x')
    expect(actions).toEqual([])

    key('/')
    expect(actions).toEqual(['search'])
  })

  it('prevents the browser default only for handled keys', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    expect(key('ArrowDown').defaultPrevented).toBe(true)
    expect(key('q').defaultPrevented).toBe(false)

    expect(actions).toEqual(['down'])
  })

  it('leaves typing to a text field, except Escape', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const actions: Action[] = []
    render((action) => actions.push(action))

    const typed = key('x', input)
    expect(typed.defaultPrevented).toBe(false)
    expect(actions).toEqual([])

    key('Escape', input)
    expect(actions).toEqual(['back'])
  })

  it('uses the latest handler without resubscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(first)
    render(second)

    key('ArrowDown')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('down')
  })

  it('stops listening once unmounted', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    unmount()
    key('ArrowDown')

    expect(actions).toEqual([])
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})

describe('gamepad', () => {
  it('fires a button once per press', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [gamepad({ pressed: [0] })]
    flushFrame()
    flushFrame()
    expect(actions).toEqual(['accept'])

    pads = [gamepad()]
    flushFrame()
    pads = [gamepad({ pressed: [0] })]
    flushFrame()
    expect(actions).toEqual(['accept', 'accept'])
  })

  it('maps the face, shoulder and system buttons', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [gamepad({ pressed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })]
    flushFrame()

    const expected: Action[] = [
      'accept',
      'back',
      'menu',
      'prevSection',
      'nextSection',
      'seekBack',
      'seekForward',
      'back',
      'menu'
    ]
    expect(actions).toEqual(expected)

    // X is deliberately unbound on a pad: Steam's desktop layout uses it.
    pads = [gamepad({ pressed: [2] })]
    flushFrame()
    expect(actions).toEqual(expected)
  })

  it('repeats a held direction after the delay, then at the repeat rate', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [gamepad({ pressed: [15] })]
    flushFrame()
    expect(actions).toEqual(['right'])

    flushFrame()
    expect(actions).toEqual(['right'])

    now.mockReturnValue(1379)
    flushFrame()
    expect(actions).toEqual(['right'])

    now.mockReturnValue(1381)
    flushFrame()
    expect(actions).toEqual(['right', 'right'])
  })

  it('ignores the stick inside the deadzone and prefers the dominant axis', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [gamepad({ axes: [0.5, 0] })]
    flushFrame()
    expect(actions).toEqual([])

    pads = [gamepad({ axes: [0, -0.9] })]
    flushFrame()
    expect(actions).toEqual(['up'])

    pads = [gamepad()]
    flushFrame()
    now.mockReturnValue(1000)
    pads = [gamepad({ axes: [0.8, 0.7] })]
    flushFrame()
    expect(actions).toEqual(['up', 'right'])
  })

  it('prefers Steam Input over a physical pad', () => {
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [
      gamepad({ id: 'Xbox Wireless Controller', pressed: [0] }),
      gamepad({ id: 'Steam Virtual Gamepad (Vendor: 28de)', pressed: [] })
    ]
    flushFrame()
    expect(actions).toEqual([])

    pads = [
      gamepad({ id: 'Xbox Wireless Controller', pressed: [0] }),
      gamepad({ id: 'Steam Virtual Gamepad (Vendor: 28de)', pressed: [0] })
    ]
    flushFrame()
    expect(actions).toEqual(['accept'])
  })

  it('ignores input while the window is unfocused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const actions: Action[] = []
    render((action) => actions.push(action))

    pads = [gamepad({ pressed: [0] })]
    flushFrame()
    expect(actions).toEqual([])

    window.dispatchEvent(new Event('focus'))
    flushFrame()
    expect(actions).toEqual(['accept'])

    window.dispatchEvent(new Event('blur'))
    flushFrame()
    expect(actions).toEqual(['accept'])
  })

  it('keeps polling when the browser has no gamepad API', () => {
    vi.stubGlobal('navigator', {})
    const actions: Action[] = []
    render((action) => actions.push(action))

    expect(() => flushFrame()).not.toThrow()
    expect(frames).toHaveLength(1)
    expect(actions).toEqual([])
  })
})
