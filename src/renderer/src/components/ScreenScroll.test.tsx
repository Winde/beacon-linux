// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScreenScroll } from './ScreenScroll'

afterEach(cleanup)

describe('ScreenScroll', () => {
  it('renders its children', () => {
    const { container } = render(
      <ScreenScroll>
        <p>content</p>
      </ScreenScroll>
    )

    expect(container.querySelector('.screen__scroll')?.textContent).toBe('content')
  })

  it('masks the top edge only while scrolled', () => {
    const { container } = render(<ScreenScroll>content</ScreenScroll>)
    const scroller = container.querySelector<HTMLElement>('.screen__scroll')!

    expect(scroller.classList.contains('is-scrolled')).toBe(false)

    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    expect(scroller.classList.contains('is-scrolled')).toBe(true)

    // A couple of pixels is padding, not scrolling.
    scroller.scrollTop = 2
    fireEvent.scroll(scroller)
    expect(scroller.classList.contains('is-scrolled')).toBe(false)
  })
})
