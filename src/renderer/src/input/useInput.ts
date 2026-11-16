import { useEffect, useRef } from 'react'
import type { Direction } from '../nav/focus'

export type Action =
  | Direction
  | 'accept'
  | 'back'
  | 'menu'
  | 'search'
  | 'prevSection'
  | 'nextSection'
  | 'seekBack'
  | 'seekForward'

const REPEAT_DELAY = 380
const REPEAT_RATE = 110
const STICK_DEADZONE = 0.55

/** Standard gamepad layout: Xbox 360/One, DualShock, and Steam Input's virtual pad. */
const BUTTON_ACTIONS: Record<number, Action> = {
  0: 'accept', // A / cross
  1: 'back', // B / circle
  2: 'search', // X / square
  3: 'menu', // Y / triangle
  4: 'prevSection', // LB
  5: 'nextSection', // RB
  6: 'seekBack', // LT
  7: 'seekForward', // RT
  8: 'back', // back / select
  9: 'menu' // start
}

/**
 * Steam Input exposes the Steam Controller and the Steam Deck's built-in pad as
 * a virtual Xbox pad with Valve's vendor id (28de). When both it and the
 * physical device are visible, only one may drive the UI.
 */
function isSteamPad(pad: Gamepad): boolean {
  return /vendor:\s*28de/i.test(pad.id) || /steam/i.test(pad.id)
}

function pickPad(pads: (Gamepad | null)[]): Gamepad | null {
  const steam = pads.find((pad) => pad && pad.connected && isSteamPad(pad))
  if (steam) return steam
  return pads.find((pad) => pad && pad.connected) ?? null
}

function readDirection(pad: Gamepad): Direction | null {
  const buttons = pad.buttons
  if (buttons[12]?.pressed) return 'up'
  if (buttons[13]?.pressed) return 'down'
  if (buttons[14]?.pressed) return 'left'
  if (buttons[15]?.pressed) return 'right'

  const x = pad.axes[0] ?? 0
  const y = pad.axes[1] ?? 0
  if (Math.abs(x) > Math.abs(y)) {
    if (x < -STICK_DEADZONE) return 'left'
    if (x > STICK_DEADZONE) return 'right'
  } else {
    if (y < -STICK_DEADZONE) return 'up'
    if (y > STICK_DEADZONE) return 'down'
  }
  return null
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable
}

const KEY_ACTIONS: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'accept',
  ' ': 'accept',
  Escape: 'back',
  Backspace: 'back',
  m: 'menu',
  '/': 'search'
}

/**
 * One place for every input source. Keyboard and gamepad both emit the same
 * actions, so screens never care which one the player is holding.
 *
 * Input is ignored while the window is unfocused, so the Steam overlay or an
 * alt-tab cannot drive the UI behind the player's back.
 */
export function useInput(handler: (action: Action) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Arrow keys belong to the caret while a text field has focus.
      if (isTyping(event.target) && event.key !== 'Escape') return
      const action = KEY_ACTIONS[event.key]
      if (!action) return
      event.preventDefault()
      handlerRef.current(action)
    }

    let focused = document.hasFocus()
    const onFocus = (): void => {
      focused = true
    }
    const onBlur = (): void => {
      focused = false
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)

    let frame = 0
    let lastDirection: Direction | null = null
    let nextRepeat = 0
    const buttonState: boolean[] = []

    const loop = (): void => {
      const pads = navigator.getGamepads?.() ?? []

      if (!focused) {
        // Drop held state so nothing is stuck when focus comes back.
        lastDirection = null
        buttonState.fill(false)
        frame = requestAnimationFrame(loop)
        return
      }

      const pad = pickPad(pads)
      if (pad) {
        const now = performance.now()
        const direction = readDirection(pad)

        if (direction) {
          if (direction !== lastDirection) {
            lastDirection = direction
            nextRepeat = now + REPEAT_DELAY
            handlerRef.current(direction)
          } else if (now >= nextRepeat) {
            nextRepeat = now + REPEAT_RATE
            handlerRef.current(direction)
          }
        } else {
          lastDirection = null
        }

        for (let index = 0; index < pad.buttons.length; index++) {
          const pressed = pad.buttons[index].pressed
          if (pressed && !buttonState[index]) {
            const action = BUTTON_ACTIONS[index]
            if (action) handlerRef.current(action)
          }
          buttonState[index] = pressed
        }
      }

      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(frame)
    }
  }, [])
}
