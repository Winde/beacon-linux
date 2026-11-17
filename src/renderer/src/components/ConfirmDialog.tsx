import { useEffect, useRef } from 'react'
import { focusWithin } from '../nav/focus'

export interface DialogAction {
  label: string
  onSelect: () => void
  /** primary = the recommended, non-destructive choice. */
  variant?: 'primary' | 'danger' | 'ghost'
  testId?: string
}

interface ConfirmDialogProps {
  title: string
  message: string
  /** Rendered in order; the first one takes focus. */
  actions: DialogAction[]
}

/**
 * A TV-sized confirmation. Directions are confined to it by the caller, which
 * also routes Back to the cancel action.
 */
export function ConfirmDialog({
  title,
  message,
  actions
}: ConfirmDialogProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) focusWithin(ref.current)
  }, [])

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        ref={ref}
      >
        <h2 className="dialog__title" id="dialog-title">
          {title}
        </h2>
        <p className="dialog__message" id="dialog-message">
          {message}
        </p>
        <div className="dialog__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`button ${
                action.variant === 'primary'
                  ? 'button--primary'
                  : action.variant === 'danger'
                    ? 'button--danger'
                    : 'button--ghost'
              }`}
              data-focus
              data-testid={action.testId}
              tabIndex={-1}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
