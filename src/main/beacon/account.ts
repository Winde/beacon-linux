/**
 * The key local, per-account data is filed under: the sign-in address,
 * lowercased. `guest` covers anything written before a member signs in.
 */
export function accountKey(email: string | null | undefined): string {
  const address = (email ?? '').trim().toLowerCase()
  return address || 'guest'
}
