import { useEffect, useState } from 'react'
import { cleanError } from './errors'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null, loading: true })
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      },
      (err: unknown) => {
        if (!cancelled) setState({ data: null, error: cleanError(err), loading: false })
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
