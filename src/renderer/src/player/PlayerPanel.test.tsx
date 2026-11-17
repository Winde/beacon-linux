// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuOption } from './model'
import { PlayerPanel } from './PlayerPanel'

afterEach(cleanup)

function options(): MenuOption[] {
  return [
    { key: 'off', label: 'Off', selected: false, run: vi.fn() },
    { key: 'en', label: 'English', selected: true, run: vi.fn() }
  ]
}

function refs(): React.RefObject<(HTMLButtonElement | null)[]> {
  return { current: [] as (HTMLButtonElement | null)[] }
}

describe('PlayerPanel', () => {
  it('names the menu and marks the selected choice', () => {
    render(
      <PlayerPanel
        panel="subtitles"
        position={null}
        options={options()}
        optionFocus={1}
        optionRefs={refs()}
        note={null}
        onChoose={vi.fn()}
      />
    )

    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeDefined()
    expect(
      screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Off' }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('puts the highlight on the focused option', () => {
    const { container } = render(
      <PlayerPanel
        panel="speed"
        position={null}
        options={options()}
        optionFocus={0}
        optionRefs={refs()}
        note={null}
        onChoose={vi.fn()}
      />
    )

    const choices = container.querySelectorAll('.player__option')
    expect(choices[0]!.classList.contains('is-focused')).toBe(true)
    expect(choices[1]!.classList.contains('is-focused')).toBe(false)
  })

  it('reports the chosen index and scrolls it into the caller refs', () => {
    const onChoose = vi.fn()
    const optionRefs = refs()
    render(
      <PlayerPanel
        panel="audio"
        position={null}
        options={options()}
        optionFocus={0}
        optionRefs={optionRefs}
        note={null}
        onChoose={onChoose}
      />
    )

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))

    expect(onChoose).toHaveBeenCalledWith(1)
    expect(optionRefs.current).toHaveLength(2)
    expect(optionRefs.current[1]?.textContent).toContain('English')
  })

  it('shows the note under the choices', () => {
    render(
      <PlayerPanel
        panel="quality"
        position={{ left: 20, bottom: 40 }}
        options={[]}
        optionFocus={0}
        optionRefs={refs()}
        note="Quality is fixed for this stream."
        onChoose={vi.fn()}
      />
    )

    expect(screen.getByRole('menu', { name: 'Quality' })).toBeDefined()
    expect(screen.getByText('Quality is fixed for this stream.')).toBeDefined()
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  })
})
