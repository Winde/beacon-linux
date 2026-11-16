import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Electron's keyring and paths are supplied by the test, so no app is needed.
const electron = vi.hoisted(() => ({
  userData: '',
  encryption: true,
  encrypted: [] as string[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => electron.encryption,
    encryptStringAsync: async (text: string) => {
      electron.encrypted.push(text)
      return Buffer.from(`enc:${text}`, 'utf8')
    },
    decryptStringAsync: async (data: Buffer) => ({
      result: data.toString('utf8').replace(/^enc:/, '')
    })
  }
}))

import { loadSession, saveSession, type Session } from './session'

const session: Session = {
  email: 'member@example.com',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000_000
}

function sessionFile(): string {
  return join(electron.userData, 'session.bin')
}

beforeEach(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'beacon-session-'))
  electron.encryption = true
  electron.encrypted = []
})

describe('saveSession and loadSession', () => {
  it('keeps the session encrypted when a keyring is available', async () => {
    await saveSession(session)

    expect(readFileSync(sessionFile(), 'utf8')).toBe(`enc:${JSON.stringify(session)}`)
    await expect(loadSession()).resolves.toEqual(session)
  })

  it('falls back to a plain private file without a keyring', async () => {
    electron.encryption = false

    await saveSession(session)

    expect(JSON.parse(readFileSync(sessionFile(), 'utf8'))).toEqual(session)
    await expect(loadSession()).resolves.toEqual(session)
  })

  it('removes the file on sign out', async () => {
    await saveSession(session)
    await saveSession(null)

    await expect(loadSession()).resolves.toBeNull()
  })

  it('returns null when no session has been saved', async () => {
    await expect(loadSession()).resolves.toBeNull()
  })

  it('returns null for a file that is not JSON', async () => {
    electron.encryption = false
    writeFileSync(sessionFile(), 'not json')

    await expect(loadSession()).resolves.toBeNull()
  })

  it('returns null when the file cannot be decrypted', async () => {
    writeFileSync(sessionFile(), 'garbage')

    await expect(loadSession()).resolves.toBeNull()
  })

  it('returns null when either token is missing', async () => {
    electron.encryption = false
    writeFileSync(sessionFile(), JSON.stringify({ accessToken: 'access-1', expiresAt: 1 }))

    await expect(loadSession()).resolves.toBeNull()
  })

  it('never throws when the session cannot be written', async () => {
    const base = mkdtempSync(join(tmpdir(), 'beacon-session-'))
    const blocker = join(base, 'blocker')
    writeFileSync(blocker, 'x')
    electron.userData = join(blocker, 'nested')

    await expect(saveSession(session)).resolves.toBeUndefined()
    await expect(loadSession()).resolves.toBeNull()
  })
})
