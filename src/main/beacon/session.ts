import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CredentialStorage } from '@shared/types'

export interface Session {
  email?: string
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.bin')
}

/**
 * Electron 45 replaced the synchronous safeStorage calls. The async variants
 * also need the app to be ready, which is why nothing here runs at import time.
 */
async function encryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Whether a Linux backend is a real keyring. `basic_text` encrypts with a key
 * baked into Chromium, which is obfuscation, not protection; `unknown` means
 * the backend has not been chosen yet and cannot be trusted either.
 */
export function backendCountsAsSecure(backend: string): boolean {
  return backend !== 'basic_text' && backend !== 'unknown'
}

/**
 * Where the session can be kept, if anywhere. Availability alone is not enough
 * on Linux: safeStorage reports itself available while falling back to
 * `basic_text`, so the selected backend has to be asked as well.
 */
export async function credentialStorage(
  platform: string = process.platform
): Promise<CredentialStorage> {
  if (!(await encryptionAvailable())) return 'unavailable'
  if (platform !== 'linux') return 'keyring'
  try {
    return backendCountsAsSecure(safeStorage.getSelectedStorageBackend()) ? 'keyring' : 'plaintext'
  } catch {
    return 'unavailable'
  }
}

/**
 * Remove a token file an older version wrote in the clear. Keyring ciphertext
 * never parses as JSON, so a file that does is ours and unprotected; anything
 * else is left alone because it may still be readable once the keyring is back.
 */
function forgetPlaintext(path: string): void {
  try {
    JSON.parse(readFileSync(path, 'utf8'))
    rmSync(path, { force: true })
  } catch {
    // No file, or not plain JSON.
  }
}

/**
 * Tokens are decrypted with the OS keyring when one is usable. When only
 * Electron's `basic_text` backend is available (SteamOS Game Mode has no
 * keyring) the same file is still written: it keeps the member signed in, but
 * its key is the one baked into Chromium, so it is obfuscation, not protection.
 * The sign-in screen says so.
 */
export async function loadSession(
  platform: NodeJS.Platform = process.platform
): Promise<Session | null> {
  const path = sessionPath()
  if ((await credentialStorage(platform)) === 'unavailable') {
    forgetPlaintext(path)
    return null
  }
  try {
    const raw = readFileSync(path)
    const text = (await safeStorage.decryptStringAsync(raw)).result
    const parsed = JSON.parse(text) as Session
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return parsed
  } catch {
    // A keyring file that cannot be decrypted, or a plaintext one left by an
    // older version. The latter is not a credential we want to keep around.
    forgetPlaintext(path)
    return null
  }
}

export async function saveSession(
  session: Session | null,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const path = sessionPath()
  if (!session) {
    rmSync(path, { force: true })
    return
  }
  // `unavailable` is the only case with nowhere to keep it. On Linux,
  // `basic_text` still gives a file, and that is what keeps Game Mode signed
  // in between launches.
  if ((await credentialStorage(platform)) === 'unavailable') {
    // A file already on disk is not ours to throw away: it is either
    // ciphertext this machine reads again once the keyring is back, or a
    // plaintext one loadSession would never restore.
    forgetPlaintext(path)
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const text = JSON.stringify(session)
    const data = await safeStorage.encryptStringAsync(text)
    writeFileSync(path, data, { mode: 0o600 })
  } catch {
    // A failed write only costs the user a re-login; never crash over it.
  }
}
