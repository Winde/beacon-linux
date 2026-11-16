/**
 * Image preloading for the hero backdrop.
 *
 * The backdrop follows focus, so its URL changes on nearly every directional
 * press. Swapping `src` before the new image has arrived leaves a blank frame
 * or the previous artwork on screen, so the hero only adopts a URL once it is
 * decoded and ready to paint.
 */

import { useEffect, useState } from 'react'

/** Backdrops span the window; 1280 is sharp on a 1080p TV and 109 KB as AVIF. */
export const HERO_WIDTH = 1280

const loaded = new Set<string>()

/**
 * Rewrite a Cloudflare Images URL to another width, e.g. `format=auto,width=480`
 * to `format=auto,width=1920`. Mirrors the main-process helper in
 * `src/main/beacon/text.ts`; cards carry thumbnail-sized URLs, which look soft
 * when stretched across the hero.
 */
export function atWidth(url: string | null, width: number): string | null {
  if (!url) return null
  const marker = 'format=auto'
  const at = url.indexOf(marker)
  if (at === -1) return url
  const afterMarker = at + marker.length
  const existing = /^,width=\d+/.exec(url.slice(afterMarker))
  const tail = url.slice(afterMarker + (existing ? existing[0].length : 0))
  return `${url.slice(0, afterMarker)},width=${width}${tail}`
}

/** Resolves when the image is usable, or immediately if it cannot be loaded. */
export function preload(url: string | null): Promise<void> {
  if (!url) return Promise.resolve()
  if (loaded.has(url)) return Promise.resolve()

  return new Promise((resolve) => {
    const image = new Image()
    const done = (): void => {
      loaded.add(url)
      resolve()
    }
    image.onload = done
    image.onerror = done
    image.src = url
    // decode() keeps the swap off the next paint; onload covers older engines.
    void image.decode?.().then(done, () => undefined)
  })
}

export function preloadAll(urls: (string | null)[]): void {
  for (const url of urls) void preload(url)
}

/**
 * Best available backdrop: the CMS's 2560-wide rendition when it exists,
 * otherwise the 800-wide landscape, which the CDN will not upscale.
 */
export function backdropUrl(
  image: string | null,
  image2x?: string | null,
  width = HERO_WIDTH
): string | null {
  return atWidth(image2x ?? image, width)
}

/**
 * Returns the URL that is safe to paint at full strength. Until the new art is
 * decoded, the caller shows a blurred low-resolution stand-in of the *same*
 * card, so a focused item never displays another item's picture.
 *
 * The backdrop follows focus, so a quick scrub through a row would otherwise
 * fire one request per card; requests are debounced until focus rests.
 */
const DEBOUNCE_MS = 120

export function useBackdrop(url: string | null): string | null {
  const [shown, setShown] = useState<string | null>(url)

  useEffect(() => {
    if (!url) {
      setShown(null)
      return
    }

    let cancelled = false
    const commit = (): void => {
      if (!cancelled) setShown(url)
    }

    if (loaded.has(url)) {
      commit()
      return
    }

    const timer = window.setTimeout(() => {
      void preload(url).then(commit)
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [url])

  return shown
}
