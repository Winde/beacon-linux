export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="spinner" role="status">
      <span className="spinner__ring" />
      {label ? <span className="spinner__label">{label}</span> : null}
    </div>
  )
}

export function ErrorNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="error-note">{children}</p>
}

export function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="empty">{children}</p>
}
