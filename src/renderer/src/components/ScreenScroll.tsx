import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Scroll container for split screens.
 *
 * The pinned header clips this scroller, which leaves a hard horizontal line
 * where tiles slide under it. While the list is scrolled, the scroller fades
 * its own top edge so content dissolves into the header instead of being cut.
 *
 * Changing `resetKey` returns the list to the top: a new tab or sort describes
 * a new list, and the reader should start at its beginning. The reset happens
 * before paint, so the new list never flashes at the old offset.
 */
export function ScreenScroll({
  children,
  resetKey
}: {
  children: React.ReactNode
  /** Any value that identifies the list currently on screen. */
  resetKey?: unknown
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = 0
    element.classList.remove('is-scrolled')
  }, [resetKey])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const sync = (): void => {
      element.classList.toggle('is-scrolled', element.scrollTop > 2)
    }
    element.addEventListener('scroll', sync, { passive: true })
    sync()
    return () => element.removeEventListener('scroll', sync)
  }, [])

  return (
    <div className="screen__scroll" ref={ref}>
      {children}
    </div>
  )
}
