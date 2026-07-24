import { seal, unseal } from './dpapi-seal.mjs'

/** Store a manually supplied dispatch credential with user-scoped DPAPI protection on Windows.
 * The shared helper deliberately degrades to plaintext elsewhere; db.ts compensates there with
 * owner-only directory/database permissions. */
export function protectAccountSecret(secret: string): string {
  // Idempotent for the boot migration: never wrap an already-protected row a second time.
  if (secret.startsWith('DPAPIv1:')) return secret
  return seal(secret)
}

/** Read a protected credential. Legacy plaintext is returned unchanged; an undecryptable
 * machine/user-bound value fails closed as null. */
export function revealAccountSecret(stored: string): string | null {
  return unseal(stored)
}
