// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preload, preloadAll } from './images'

class FakeImage {
  static readonly instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  // The real decode() resolves when the bytes are ready; tests control that
  // moment through load()/fail() instead.
  decode = vi.fn(() => new Promise<void>(() => {}))

  constructor() {
    FakeImage.instances.push(this)
  }

  /** Pretend the network answered with usable bytes. */
  load(): void {
    this.onload?.()
  }

  /** Pretend the URL could not be fetched. */
  fail(): void {
    this.onerror?.()
  }
}

beforeEach(() => {
  FakeImage.instances.length = 0
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastImage(): FakeImage {
  const image = FakeImage.instances.at(-1)
  if (!image) throw new Error('no Image was created')
  return image
}

describe('preload', () => {
  it('resolves at once when there is nothing to load', async () => {
    await expect(preload(null)).resolves.toBeUndefined()
    expect(FakeImage.instances).toHaveLength(0)
  })

  it('resolves only once the image can be painted', async () => {
    let settled = false
    const pending = preload('https://images.example/one.jpg').then(() => {
      settled = true
    })

    const image = lastImage()
    expect(image.src).toBe('https://images.example/one.jpg')
    expect(settled).toBe(false)

    image.load()
    await pending
    expect(settled).toBe(true)
  })

  it('resolves a URL that fails, so a caller never hangs', async () => {
    const pending = preload('https://images.example/broken.jpg')

    lastImage().fail()

    await expect(pending).resolves.toBeUndefined()
  })

  it('does not ask for the same image twice', async () => {
    const first = preload('https://images.example/cached.jpg')
    lastImage().load()
    await first
    const images = FakeImage.instances.length

    await preload('https://images.example/cached.jpg')

    expect(FakeImage.instances).toHaveLength(images)
  })

  it('warms every backdrop it is given', () => {
    preloadAll(['https://images.example/a.jpg', null, 'https://images.example/b.jpg'])

    expect(FakeImage.instances.map((image) => image.src)).toEqual([
      'https://images.example/a.jpg',
      'https://images.example/b.jpg'
    ])
  })
})
