import { useEffect, useRef } from 'react'

/**
 * Scroll container for split screens.
 *
 * The pinned header clips this scroller, which leaves a hard horizontal line
 * where tiles slide under it. While the list is scrolled, the scroller masks
 * its own top edge so content dissolves into the header instead of being cut.
 */
export function ScreenScroll({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

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
