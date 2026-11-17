import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Electron's keyring and paths are supplied by the test, so no app is needed.
const electron = vi.hoisted(() => ({
  userData: '',
  encryption: true,
  backend: 'gnome_libsecret',
  encrypted: [] as string[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => electron.encryption,
    getSelectedStorageBackend: () => electron.backend,
    encryptStringAsync: async (text: string) => {
      electron.encrypted.push(text)
      return Buffer.from(`enc:${text}`, 'utf8')
    },
    decryptStringAsync: async (data: Buffer) => ({
      result: data.toString('utf8').replace(/^enc:/, '')
    })
  }
}))

import {
  backendCountsAsSecure,
  credentialStorage,
  loadSession,
  saveSession,
  type Session
} from './session'

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
  electron.backend = 'gnome_libsecret'
  electron.encrypted = []
})

describe('saveSession and loadSession', () => {
  it('keeps the session encrypted when a keyring is available', async () => {
    await saveSession(session)

    expect(readFileSync(sessionFile(), 'utf8')).toBe(`enc:${JSON.stringify(session)}`)
    await expect(loadSession()).resolves.toEqual(session)
  })

  it('writes nothing when encryption is unavailable', async () => {
    electron.encryption = false

    await saveSession(session)

    expect(existsSync(sessionFile())).toBe(false)
    await expect(loadSession()).resolves.toBeNull()
  })

  it('keeps the session with the basic_text backend', async () => {
    electron.backend = 'basic_text'

    await saveSession(session, 'linux')

    expect(readFileSync(sessionFile(), 'utf8')).toBe(`enc:${JSON.stringify(session)}`)
    await expect(loadSession('linux')).resolves.toEqual(session)
  })

  it('does not restore a plaintext session left by an older version', async () => {
    electron.encryption = false
    writeFileSync(sessionFile(), JSON.stringify(session))

    await expect(loadSession()).resolves.toBeNull()

    expect(existsSync(sessionFile())).toBe(false)
  })

  it('leaves a file it cannot identify alone when the keyring is unavailable', async () => {
    electron.encryption = false
    writeFileSync(sessionFile(), 'v10 ciphertext, not json')

    await expect(loadSession()).resolves.toBeNull()

    expect(existsSync(sessionFile())).toBe(true)
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

describe('credentialStorage', () => {
  it('does not count basic_text as a keyring', () => {
    expect(backendCountsAsSecure('basic_text')).toBe(false)
    expect(backendCountsAsSecure('unknown')).toBe(false)
    expect(backendCountsAsSecure('gnome_libsecret')).toBe(true)
    expect(backendCountsAsSecure('kwallet6')).toBe(true)
  })

  it('reports the keyring when Electron has encryption', async () => {
    await expect(credentialStorage('win32')).resolves.toBe('keyring')
  })

  it('reports the keyring for a real Linux backend', async () => {
    await expect(credentialStorage('linux')).resolves.toBe('keyring')
  })

  it('reports plaintext when Linux only offers basic_text', async () => {
    electron.backend = 'basic_text'

    await expect(credentialStorage('linux')).resolves.toBe('plaintext')
  })

  it('reports unavailable without encryption', async () => {
    electron.encryption = false

    await expect(credentialStorage('linux')).resolves.toBe('unavailable')
  })
})
