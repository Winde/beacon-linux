interface OnScreenKeyboardProps {
  onChar: (char: string) => void
  onBackspace: () => void
  onClear: () => void
  onSubmit: () => void
}

/** Letters then digits: 36 keys, which is exactly six rows of six. */
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'0123456789'.split('')]

/**
 * The keyboard a d-pad can actually use. Every key is a focus target, so the
 * spatial navigator walks the grid and `accept` presses the focused key —
 * no dependency on a desktop or Steam on-screen keyboard.
 */
export function OnScreenKeyboard({
  onChar,
  onBackspace,
  onClear,
  onSubmit
}: OnScreenKeyboardProps): React.JSX.Element {
  return (
    <div className="keyboard">
      <div className="keyboard__grid" data-focus-row>
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="key"
            data-focus
            tabIndex={-1}
            onClick={() => onChar(key.toLowerCase())}
          >
            {key}
          </button>
        ))}
      </div>
      <div className="keyboard__actions" data-focus-row>
        <button type="button" className="key" data-focus tabIndex={-1} onClick={() => onChar(' ')}>
          Space
        </button>
        <button type="button" className="key" data-focus tabIndex={-1} onClick={onBackspace}>
          Delete
        </button>
        <button type="button" className="key" data-focus tabIndex={-1} onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          className="key key--primary"
          data-focus
          data-testid="search-submit"
          tabIndex={-1}
          onClick={onSubmit}
        >
          Search
        </button>
      </div>
    </div>
  )
}
