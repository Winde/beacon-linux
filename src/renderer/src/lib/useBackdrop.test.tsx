// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preload, useBackdrop } from './images'

class FakeImage {
  static readonly instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  decode = vi.fn(() => new Promise<void>(() => {}))

  constructor() {
    FakeImage.instances.push(this)
  }

  load(): void {
    this.onload?.()
  }
}

beforeEach(() => {
  FakeImage.instances.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Let the hook start and finish a load for a URL that has not been seen. */
async function load(_url: string): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(120)
  })
  const image = FakeImage.instances.at(-1)
  if (!image) throw new Error('no image request was started')
  await act(async () => {
    image.load()
    await Promise.resolve()
  })
}

describe('useBackdrop', () => {
  it('never paints the previous card while the next backdrop decodes', async () => {
    const { result, rerender } = renderHook((url: string | null) => useBackdrop(url), {
      initialProps: 'https://images.example/backdrop-one.jpg'
    })

    await load('https://images.example/backdrop-one.jpg')
    expect(result.current).toBe('https://images.example/backdrop-one.jpg')

    rerender('https://images.example/backdrop-two.jpg')

    // The caller now has a blurred stand-in of card two. Card one's backdrop
    // must not sit on top of it while card two's art is on the way.
    expect(result.current).toBeNull()

    await load('https://images.example/backdrop-two.jpg')
    expect(result.current).toBe('https://images.example/backdrop-two.jpg')
  })

  it('waits for focus to rest before asking for the image', () => {
    const { rerender } = renderHook((url: string | null) => useBackdrop(url), {
      initialProps: 'https://images.example/first.jpg' as string | null
    })
    const before = FakeImage.instances.length

    rerender('https://images.example/debounced.jpg')
    act(() => vi.advanceTimersByTime(119))
    expect(FakeImage.instances).toHaveLength(before)

    act(() => vi.advanceTimersByTime(1))
    expect(FakeImage.instances).toHaveLength(before + 1)
  })

  it('switches at once to an image that is already warm', async () => {
    const warm = 'https://images.example/warm.jpg'
    const pending = preload(warm)
    FakeImage.instances.at(-1)!.load()
    await pending

    const { result } = renderHook(() => useBackdrop(warm))

    expect(result.current).toBe(warm)
  })

  it('clears the backdrop when the card has no art', async () => {
    const { result, rerender } = renderHook((url: string | null) => useBackdrop(url), {
      initialProps: 'https://images.example/with-art.jpg' as string | null
    })
    await load('https://images.example/with-art.jpg')
    expect(result.current).toBe('https://images.example/with-art.jpg')

    rerender(null)

    expect(result.current).toBeNull()
  })
})
