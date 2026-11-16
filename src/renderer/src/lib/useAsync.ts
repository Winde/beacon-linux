import { useEffect, useState } from 'react'
import { cleanError } from './errors'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export interface AsyncOptions {
  /**
   * Keep the previous value on screen while a reload runs, instead of blanking
   * the screen to a spinner. Meant for refreshes behind the viewer's back.
   */
  keepData?: boolean
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions = {}
): AsyncState<T> {
  const { keepData = false } = options
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState((previous) =>
      keepData && previous.data !== null
        ? { ...previous, error: null }
        : { data: null, error: null, loading: true }
    )
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
