import { describe, expect, it } from 'vitest'
import { accountKey } from './account'

describe('accountKey', () => {
  it('files an address under its trimmed lower-case form', () => {
    expect(accountKey(' Member@Example.COM ')).toBe('member@example.com')
    expect(accountKey('member@example.com')).toBe('member@example.com')
  })

  it('uses one key for the same address typed in different cases', () => {
    expect(accountKey('MEMBER@example.com')).toBe(accountKey('member@EXAMPLE.com'))
  })

  it('falls back to the guest key when there is no address', () => {
    expect(accountKey(null)).toBe('guest')
    expect(accountKey(undefined)).toBe('guest')
    expect(accountKey('')).toBe('guest')
    expect(accountKey('   ')).toBe('guest')
  })
})
