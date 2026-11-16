import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Card } from '@shared/types'

/** The bucket used while nobody is signed in. */
export const GUEST_ACCOUNT = 'guest'

/**
 * What is written to disk for one saved title: its Beacon id and nothing that
 * can be fetched again. Display data is hydrated separately from the catalog.
 */
export interface WatchlistEntry {
  kind: Card['kind']
  id: string
  /** epoch ms, newest first */
  addedAt: number
}

export interface StoredWatchlist {
  items: WatchlistEntry[]
  rowsAbove: number | null
}

type StoredAccount = StoredWatchlist

interface StoredFile {
  version: 2
  accounts: Record<string, StoredAccount>
}

/**
 * The key a local list belongs to. The sign-in address is used because it is
 * known as soon as a session exists and survives a rejected token: losing the
 * session must not lose the watchlist.
 */
export function accountKey(email: string | null | undefined): string {
  const address = (email ?? '').trim().toLowerCase()
  return address || GUEST_ACCOUNT
}

function normalizeEntry(value: unknown): WatchlistEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<WatchlistEntry>
  if (
    (entry.kind !== 'video' && entry.kind !== 'series') ||
    typeof entry.id !== 'string' ||
    !entry.id
  ) {
    return null
  }
  return {
    kind: entry.kind,
    id: entry.id,
    addedAt:
      typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt)
        ? entry.addedAt
        : Date.now()
  }
}

function normalizeAccount(value: unknown): StoredAccount {
  const account = (value ?? {}) as Partial<StoredAccount>
  const items = Array.isArray(account.items) ? account.items : []
  return {
    items: items.map(normalizeEntry).filter((item): item is WatchlistEntry => item !== null),
    rowsAbove:
      typeof account.rowsAbove === 'number' &&
      Number.isInteger(account.rowsAbove) &&
      account.rowsAbove >= 0
        ? account.rowsAbove
        : null
  }
}

/**
 * The Watchlist is not Beacon data, so it gets its own plain-text file beside
 * the encrypted session. It holds ids, so it stays small and survives changes
 * to titles or artwork; nothing in it is a credential.
 */
export class WatchlistStore {
  constructor(private readonly path: () => string) {}

  list(email: string | null): StoredWatchlist {
    const account = this.read().accounts[accountKey(email)]
    return account
      ? { items: account.items, rowsAbove: account.rowsAbove }
      : { items: [], rowsAbove: null }
  }

  add(email: string | null, entry: WatchlistEntry): StoredWatchlist {
    const file = this.read()
    const key = accountKey(email)
    const account = file.accounts[key] ?? { items: [], rowsAbove: null }
    const index = account.items.findIndex(
      (saved) => saved.kind === entry.kind && saved.id === entry.id
    )
    if (index >= 0) {
      // Keep its place and when it was first saved.
      account.items[index] = { ...entry, addedAt: account.items[index].addedAt }
    } else {
      account.items = [entry, ...account.items]
    }
    file.accounts[key] = account
    this.write(file)
    return { items: account.items, rowsAbove: account.rowsAbove }
  }

  remove(email: string | null, kind: Card['kind'], id: string): StoredWatchlist {
    const file = this.read()
    const key = accountKey(email)
    const account = file.accounts[key]
    if (!account) return { items: [], rowsAbove: null }
    account.items = account.items.filter((item) => item.kind !== kind || item.id !== id)
    this.write(file)
    return { items: account.items, rowsAbove: account.rowsAbove }
  }

  setPosition(email: string | null, rowsAbove: number): StoredWatchlist {
    const file = this.read()
    const key = accountKey(email)
    const account = file.accounts[key] ?? { items: [], rowsAbove: null }
    account.rowsAbove =
      Number.isFinite(rowsAbove) && rowsAbove >= 0 ? Math.floor(rowsAbove) : null
    file.accounts[key] = account
    this.write(file)
    return { items: account.items, rowsAbove: account.rowsAbove }
  }

  /** Delete this account's list. Other people's lists on the device stay. */
  clear(email: string | null): StoredWatchlist {
    const file = this.read()
    delete file.accounts[accountKey(email)]
    if (Object.keys(file.accounts).length) this.write(file)
    else this.removeFile()
    return { items: [], rowsAbove: null }
  }

  private read(): StoredFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path(), 'utf8')) as Partial<StoredFile>
      const source =
        parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {}
      const accounts: Record<string, StoredAccount> = {}
      for (const [key, value] of Object.entries(source)) {
        accounts[key] = normalizeAccount(value)
      }
      return { version: 2, accounts }
    } catch {
      // No file yet, or one that is damaged beyond use. An empty list is the
      // only safe answer; it must never stop the app from starting.
      return { version: 2, accounts: {} }
    }
  }

  private write(file: StoredFile): void {
    try {
      const target = this.path()
      mkdirSync(dirname(target), { recursive: true })
      // Write beside the target and swap it in, so a crash mid-write cannot
      // leave a half-written list behind.
      const temporary = `${target}.tmp`
      writeFileSync(temporary, JSON.stringify(file), { mode: 0o600 })
      renameSync(temporary, target)
    } catch {
      // A local convenience list is not worth crashing over.
    }
  }

  private removeFile(): void {
    try {
      rmSync(this.path(), { force: true })
    } catch {
      // Already gone, or the directory is not writable.
    }
  }
}

export function watchlistPath(userData: string): string {
  return join(userData, 'watchlist.json')
}
