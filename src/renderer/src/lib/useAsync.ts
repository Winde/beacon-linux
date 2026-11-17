import { useEffect, useState } from 'react'
import { cleanError } from './errors'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /**
   * A request is in flight while data from an earlier one is already on
   * screen. `loading` stays false then: there is something to look at.
   */
  refreshing: boolean
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
    loading: initial === undefined,
    refreshing: false
  })

  useEffect(() => {
    let cancelled = false
    setState((previous) =>
      holdData && previous.data !== null
        ? { ...previous, error: null, loading: false, refreshing: true }
        : { data: null, error: null, loading: true, refreshing: false }
    )
    load().then(
      (data) => {
        if (!cancelled) {
          setState({ data, error: null, loading: false, refreshing: false })
        }
      },
      (err: unknown) => {
        if (cancelled) return
        const message = cleanError(err)
        setState((previous) =>
          // A failed refresh must not throw away what the viewer is looking
          // at. The screen can say it could not refresh; it cannot un-show it.
          holdData && previous.data !== null
            ? { data: previous.data, error: message, loading: false, refreshing: false }
            : { data: null, error: message, loading: false, refreshing: false }
        )
      }
    )
    return () => {
      cancelled = true
    }
    // `deps` is the caller's dependency list by design: `load` is a fresh
    // closure on every render and would restart the request each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
