import { useEffect, useRef, useState } from 'react'
import type { ReleaseNote } from '@shared/types'
import { focusFirst } from '../nav/focus'
import type { DialogAction } from './ConfirmDialog'
import { DelayedSpinner, Spinner } from './ui'

/** What the update dialog is saying right now. `checking` lives in the rail. */
export type UpdatePrompt =
  | { name: 'current'; version: string }
  | { name: 'available'; current: string; latest: string; canInstall: boolean }
  | { name: 'installing'; latest: string }
  | { name: 'restarting'; latest: string }
  | { name: 'failed'; stage: 'check' | 'install'; reason: string }

interface UpdateDialogProps {
  prompt: UpdatePrompt
  onClose: () => void
  onInstall: () => void
  onRetry: () => void
}

type NotesState =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'ready'; releases: ReleaseNote[] }
  | { name: 'failed' }

/**
 * The update flow's one decision per state: nothing to do, install (with the
 * restart it implies), or try again. Installing is deliberately uncancellable:
 * the file is already on its way over, and backing out of the dialog while it
 * finishes would restart the app under the viewer.
 */
export function UpdateDialog({
  prompt,
  onClose,
  onInstall,
  onRetry
}: UpdateDialogProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const latest = prompt.name === 'available' ? prompt.latest : null
  const [notes, setNotes] = useState<NotesState>({ name: 'idle' })

  // A new prompt brings new actions; the first one takes focus, never a
  // heading in the changelog above it. The busy states have none, and the
  // caller swallows input until the restart.
  useEffect(() => {
    if (ref.current) focusFirst('[data-focus="action"]', ref.current)
  }, [prompt.name])

  // Notes are a second request, so they are read only once an update is on
  // offer. The main process caches them for that release; a failed read does
  // not take the install action down with it.
  useEffect(() => {
    if (!latest) {
      setNotes({ name: 'idle' })
      return
    }
    let cancelled = false
    setNotes({ name: 'loading' })
    void window.beacon.updates
      .notes()
      .then((releases) => {
        if (!cancelled) setNotes(releases.length ? { name: 'ready', releases } : { name: 'idle' })
      })
      .catch(() => {
        if (!cancelled) setNotes({ name: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [latest])

  const busy = prompt.name === 'installing' || prompt.name === 'restarting'
  let title: string
  let message: string
  const actions: DialogAction[] = []

  switch (prompt.name) {
    case 'current':
      title = "You're up to date"
      message = `Beacon v${prompt.version} is the latest version.`
      actions.push({
        label: 'Close',
        onSelect: onClose,
        variant: 'primary',
        testId: 'update-close'
      })
      break
    case 'available':
      title = `Beacon v${prompt.latest} is available`
      message = prompt.canInstall
        ? `You have v${prompt.current}. Beacon downloads the update, checks it against the release's SHA-256, then restarts.`
        : `You have v${prompt.current}. This copy can't replace itself: download the new version from the Beacon releases page on GitHub.`
      actions.push({ label: 'Later', onSelect: onClose, variant: 'ghost', testId: 'update-later' })
      if (prompt.canInstall) {
        actions.push({
          label: 'Update now',
          onSelect: onInstall,
          variant: 'primary',
          testId: 'update-install'
        })
      } else {
        actions.push({
          label: 'Close',
          onSelect: onClose,
          variant: 'primary',
          testId: 'update-close'
        })
      }
      break
    case 'installing':
      title = 'Updating Beacon'
      message = `Downloading Beacon v${prompt.latest}…`
      break
    case 'restarting':
      title = 'Updating Beacon'
      message = `Beacon v${prompt.latest} is installed. Restarting…`
      break
    case 'failed':
      title = prompt.stage === 'check' ? "Couldn't check for updates" : "Couldn't update Beacon"
      message = prompt.reason
      actions.push({
        label: 'Close',
        onSelect: onClose,
        variant: 'ghost',
        testId: 'update-close'
      })
      actions.push({
        label: 'Try again',
        onSelect: onRetry,
        variant: 'primary',
        testId: 'update-retry'
      })
      break
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        aria-describedby="update-dialog-message"
        aria-busy={busy}
        ref={ref}
      >
        <h2 className="dialog__title" id="update-dialog-title">
          {title}
        </h2>
        <div className="dialog__message" id="update-dialog-message">
          {busy ? <Spinner label={message} /> : message}
        </div>
        {prompt.name === 'available' ? <ReleaseNotes state={notes} /> : null}
        {actions.length > 0 ? (
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
                data-focus="action"
                data-testid={action.testId}
                tabIndex={-1}
                onClick={action.onSelect}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The changelog for everything between the running version and the offered
 * one. The pane scrolls; each version heading is a focus stop, so a controller
 * can walk the releases and the pane follows.
 */
function ReleaseNotes({ state }: { state: NotesState }): React.JSX.Element | null {
  if (state.name === 'idle') return null
  return (
    <div
      className="dialog__notes"
      role="region"
      aria-label="Release notes"
      data-testid="update-notes"
    >
      {state.name === 'loading' ? <DelayedSpinner label="Loading release notes…" /> : null}
      {state.name === 'failed' ? (
        <p className="dialog__notes-status">Release notes couldn&apos;t be loaded.</p>
      ) : null}
      {state.name === 'ready'
        ? state.releases.map((release) => (
            <section className="dialog__release" key={release.version}>
              <h3 className="dialog__release-title" tabIndex={-1} data-focus>
                v{release.version}
              </h3>
              {release.notes ? (
                <p className="dialog__release-body">{release.notes}</p>
              ) : (
                <p className="dialog__release-body">No notes for this release.</p>
              )}
            </section>
          ))
        : null}
    </div>
  )
}
