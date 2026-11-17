// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAsync, type AsyncState } from './useAsync'

// React 19 only collects act() warnings when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface ProbeProps {
  load: () => Promise<unknown>
  deps: unknown[]
  keepData?: boolean
  initial?: unknown
}

let latest: AsyncState<unknown>
let root: Root
let container: HTMLDivElement

function Probe({ load, deps, keepData = false, initial }: ProbeProps): null {
  latest = useAsync(load, deps, { keepData, initial })
  return null
}

function render(
  load: () => Promise<unknown>,
  deps: unknown[] = [],
  keepData = false,
  initial?: unknown
): void {
  act(() => {
    root.render(createElement(Probe, { load, deps, keepData, initial }))
  })
}

/** Let the pending promise callbacks and their state updates run. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAsync', () => {
  it('starts loading and exposes the value', async () => {
    const load = vi.fn(async () => 'data')
    render(load)

    expect(latest).toEqual({ data: null, error: null, loading: true, refreshing: false })

    await settle()

    expect(latest).toEqual({ data: 'data', error: null, loading: false, refreshing: false })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('turns a rejection into a message the UI can show', async () => {
    const load = vi
      .fn()
      .mockRejectedValue(
        new Error("Error invoking remote method 'catalog:content': Error: Video not found.")
      )
    render(load)

    await settle()

    expect(latest).toEqual({
      data: null,
      error: 'Video not found.',
      loading: false,
      refreshing: false
    })
  })

  it('clears the previous value while reloading', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(new Promise(() => {}))
    render(load, [1])
    await settle()
    expect(latest.data).toBe('first')

    render(load, [2])

    expect(latest).toEqual({ data: null, error: null, loading: true, refreshing: false })
  })

  it('holds the previous value on screen when a reload keeps it', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(new Promise(() => {}))
    render(load, [1], true)
    await settle()
    expect(latest.data).toBe('first')

    render(load, [2], true)

    expect(latest).toEqual({ data: 'first', error: null, loading: false, refreshing: true })
  })

  it('shows a prepared value at once and keeps it while it refreshes', () => {
    const load = vi.fn(() => new Promise<unknown>(() => {}))
    render(load, [], false, 'prepared')

    expect(latest).toEqual({ data: 'prepared', error: null, loading: false, refreshing: true })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores a response that belongs to an older request', async () => {
    const first = deferred<string>()
    const load = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => 'second')
    render(load, [1])
    render(load, [2])
    await settle()
    expect(latest.data).toBe('second')

    first.resolve('first')
    await settle()

    expect(latest.data).toBe('second')
  })

  it('reports a failed refresh instead of pretending the held value is fresh', async () => {
    const refresh = deferred<string>()
    const load = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => refresh.promise)
    render(load, [1], true)
    await settle()
    expect(latest.data).toBe('first')

    render(load, [2], true)
    expect(latest).toEqual({ data: 'first', error: null, loading: false, refreshing: true })

    refresh.reject(new Error('offline'))
    await settle()

    expect(latest.loading).toBe(false)
    expect(latest.refreshing).toBe(false)
    expect(latest.error).toContain('offline')
    // The failed refresh must leave the viewer on the page they were reading.
    expect(latest.data).toBe('first')
  })
})
