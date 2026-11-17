import { describe, expect, it } from 'vitest'
import { cleanError } from './errors'

describe('cleanError', () => {
  it('unwraps the Electron IPC wrapper', () => {
    const error = new Error(
      "Error invoking remote method 'beacon:signIn': Error: Invalid credentials"
    )
    expect(cleanError(error)).toBe('Invalid credentials')
  })

  it('unwraps a wrapper without a nested Error prefix', () => {
    const error = new Error("Error invoking remote method 'catalog:home': Series not found.")
    expect(cleanError(error)).toBe('Series not found.')
  })

  it('drops a leading Error prefix', () => {
    expect(cleanError(new Error('Error: Stream host not allowed'))).toBe('Stream host not allowed')
  })

  it('leaves an ordinary message alone', () => {
    expect(cleanError(new Error('Beacon answered HTTP 500'))).toBe('Beacon answered HTTP 500')
  })

  it('keeps an Error prefix that is not at the start', () => {
    expect(cleanError(new Error('Refresh failed: Error: token expired'))).toBe(
      'Refresh failed: Error: token expired'
    )
  })

  it('accepts values that are not Error instances', () => {
    expect(cleanError('plain string')).toBe('plain string')
    expect(cleanError(42)).toBe('42')
    expect(cleanError(null)).toBe('null')
    expect(cleanError(undefined)).toBe('undefined')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanError(new Error('  boom  '))).toBe('boom')
  })
})
