/** IPC errors arrive wrapped; show the part a person can act on. */
export function cleanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}

/**
 * The CMS says the series/episode itself is gone. The main process turns its
 * empty result into `null`, so this is raised here rather than parsed out of
 * an IPC error message. It is the one failure that drops the saved copy: a
 * network failure keeps it.
 */
export class PageMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageMissingError'
  }
}

export function isPageMissing(error: unknown): error is PageMissingError {
  return error instanceof PageMissingError
}
