/** IPC errors arrive wrapped; show the part a person can act on. */
export function cleanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}
