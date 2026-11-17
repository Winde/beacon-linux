import { Check } from 'iconoir-react'
import { PANEL_TITLES, type MenuOption, type Panel } from './model'

interface PlayerPanelProps {
  panel: Panel
  position: { left: number; bottom: number } | null
  options: MenuOption[]
  optionFocus: number
  optionRefs: React.RefObject<(HTMLButtonElement | null)[]>
  note: string | null
  onChoose: (index: number) => void
}

/** The pop-up menu above the control that opened it. */
export function PlayerPanel({
  panel,
  position,
  options,
  optionFocus,
  optionRefs,
  note,
  onChoose
}: PlayerPanelProps): React.JSX.Element {
  return (
    <div
      className="player__panel"
      role="menu"
      aria-label={PANEL_TITLES[panel]}
      style={position ?? undefined}
    >
      <p className="player__panel-title">{PANEL_TITLES[panel]}</p>
      {options.map((option, index) => (
        <button
          key={option.key}
          ref={(element) => {
            optionRefs.current[index] = element
          }}
          type="button"
          role="menuitemradio"
          aria-checked={option.selected}
          className={`player__option${optionFocus === index ? ' is-focused' : ''}`}
          tabIndex={-1}
          onClick={() => onChoose(index)}
        >
          <span>{option.label}</span>
          {option.selected ? <Check width={20} height={20} strokeWidth={2} aria-hidden /> : null}
        </button>
      ))}
      {note ? <p className="player__panel-note">{note}</p> : null}
    </div>
  )
}
