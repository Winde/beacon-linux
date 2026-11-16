import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
 * Tokens are encrypted with the OS keyring when one is reachable. On Linux
 * without a keyring (some SteamOS setups) safeStorage is unavailable, so we
 * fall back to a plain file in the app's private userData directory.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const raw = readFileSync(sessionPath())
    const text = (await encryptionAvailable())
      ? (await safeStorage.decryptStringAsync(raw)).result
      : raw.toString('utf8')
    const parsed = JSON.parse(text) as Session
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveSession(session: Session | null): Promise<void> {
  const path = sessionPath()
  if (!session) {
    rmSync(path, { force: true })
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const text = JSON.stringify(session)
    const data = (await encryptionAvailable())
      ? await safeStorage.encryptStringAsync(text)
      : Buffer.from(text, 'utf8')
    writeFileSync(path, data, { mode: 0o600 })
  } catch {
    // A failed write only costs the user a re-login; never crash over it.
  }
}
