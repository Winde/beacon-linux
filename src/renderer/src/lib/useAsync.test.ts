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
}

let latest: AsyncState<unknown>
let root: Root
let container: HTMLDivElement

function Probe({ load, deps }: ProbeProps): null {
  latest = useAsync(load, deps)
  return null
}

function render(load: () => Promise<unknown>, deps: unknown[] = []): void {
  act(() => {
    root.render(createElement(Probe, { load, deps }))
  })
}

/** Let the pending promise callbacks and their state updates run. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

    expect(latest).toEqual({ data: null, error: null, loading: true })

    await settle()

    expect(latest).toEqual({ data: 'data', error: null, loading: false })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('turns a rejection into a message the UI can show', async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new Error("Error invoking remote method 'catalog:content': Error: Video not found."))
    render(load)

    await settle()

    expect(latest).toEqual({ data: null, error: 'Video not found.', loading: false })
  })

  it('clears the previous value while reloading', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockReturnValueOnce(new Promise(() => {}))
    render(load, [1])
    await settle()
    expect(latest.data).toBe('first')

    render(load, [2])

    expect(latest).toEqual({ data: null, error: null, loading: true })
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
})
