import { useEffect, useState } from 'react'
import { cleanError } from './errors'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export interface AsyncOptions<T> {
  /**
   * Keep the previous value on screen while a reload runs, instead of blanking
   * the screen to a spinner. Meant for refreshes behind the viewer's back.
   */
  keepData?: boolean
  /**
   * A value the caller already fetched, shown at once instead of a spinner.
   * The load still runs, so the screen still refreshes.
   */
  initial?: T
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions<T> = {}
): AsyncState<T> {
  const { keepData = false, initial } = options
  // A prepared value is data for this screen: hold it while the refresh runs.
  const holdData = keepData || initial !== undefined
  const [state, setState] = useState<AsyncState<T>>({
    data: initial ?? null,
    error: null,
    loading: initial === undefined
  })

  useEffect(() => {
    let cancelled = false
    setState((previous) =>
      holdData && previous.data !== null
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
