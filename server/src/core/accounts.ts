// server/src/core/accounts.ts — instance-account identity resolution (PLAN.md §2).
// Adapted from an internal LunarWerx tool's instance-account resolver: imports DTOs/tier/
// constants from ./shared (local, no cross-repo import) instead of ../../../shared/index;
// the identity cache resolves via paths.ts's accountsCacheFile()/appDataDir(), which are
// now wired to THIS app's CONFIG_DIR (~/.ccmanagerui/instances-cache.json).
//
// Resolves which Anthropic account an isolated Claude Desktop **instance** is logged into —
// distinct from this app's own sqlite `accounts` table (Anthropic auth secrets for queue
// dispatch, see server/src/db.ts). Referred to as "instance account" throughout to keep the
// two concepts unambiguous; this module never touches the sqlite accounts table.
//
//   1. Cheap pre-check: <instanceDir>/config.json -> lastKnownAccountUuid (logged in at all?).
//   2. Decrypt oauth:tokenCacheV2 (fallback oauth:tokenCache) via ../crypto, parse the grants
//      map (key "<acctUuid>:<orgUuid>:https://api.anthropic.com:<scopes>"), pick the grant
//      with the max expiresAt, and pull the token/subscriptionType/rateLimitTier/uuids out.
//   3. If noNetwork / expired / no token -> resolve from our own local identity cache
//      (instances-cache.json under appDataDir()), overlaid with anything we did manage to
//      decrypt locally (uuid/orgUuid/plan/tier) even without a network call.
//   4. Otherwise call the profile endpoint, map the response, write identity ONLY (never the
//      token) back to the cache, and return a 'live' result.
//
// Nothing in this file throws for expected failure conditions (missing/corrupt config.json,
// locked files, decrypt failure, network/timeout/401, malformed profile JSON) — every path
// returns a CMAccount instead.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { decryptSafeStorage } from './crypto/index'
import { accountsCacheFile, appDataDir, normalizeInstancePath } from './paths'
import type { CMAccount, CMAccountCacheEntry } from './shared'
import { OAUTH_BETA_HEADER, PROFILE_API_URL, prettyTier } from './shared'

// ----------------------------------------------------------------------------
// Small internal helpers (all defensive — never throw out of this module)
// ----------------------------------------------------------------------------

function log(_level: 'info' | 'warn' | 'error', _message: string): void {
  // Placeholder for a future shared logger; kept as a no-op call site so call sites below
  // don't need to change when server/src wires up real logging. Never throws.
  try {
    // Intentionally silent by default — avoid noisy stdout in a desktop app daemon.
  } catch {
    /* logging must never break the caller */
  }
}

function buildLabel(
  name: string | null,
  email: string | null,
  prettyTierLabel: string | null,
): string {
  let namePart: string | null = null
  if (name && email) namePart = `${name} <${email}>`
  else if (name) namePart = name
  else if (email) namePart = email

  if (namePart && prettyTierLabel) return `${namePart} · ${prettyTierLabel}`
  if (namePart) return namePart
  if (prettyTierLabel) return prettyTierLabel
  return '(unknown account)'
}

function newAccount(partial: Partial<CMAccount> & { status: CMAccount['status'] }): CMAccount {
  return {
    status: partial.status,
    email: partial.email ?? null,
    name: partial.name ?? null,
    plan: partial.plan ?? null,
    rateLimitTier: partial.rateLimitTier ?? null,
    accountUuid: partial.accountUuid ?? null,
    orgUuid: partial.orgUuid ?? null,
    orgName: partial.orgName ?? null,
    source: partial.source ?? partial.status,
    label: partial.label ?? '(unknown account)',
  }
}

// ----------------------------------------------------------------------------
// Identity cache (instances-cache.json under appDataDir()) — identity ONLY, never tokens.
// ----------------------------------------------------------------------------

type AccountsCacheFile = Record<string, CMAccountCacheEntry>

function readAccountsCache(): AccountsCacheFile {
  try {
    const file = accountsCacheFile()
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf8')
    if (!raw?.trim()) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as AccountsCacheFile
    return {}
  } catch (err) {
    log('warn', `readAccountsCache: failed to load instances-cache.json: ${String(err)}`)
    return {}
  }
}

function writeAccountsCacheEntry(instanceDir: string, entry: CMAccountCacheEntry): boolean {
  try {
    const dir = appDataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const cache = readAccountsCache()
    const key = normalizeInstancePath(instanceDir)

    // Defensively strip anything beyond the identity-only shape (never persist a token here).
    const safeEntry: CMAccountCacheEntry = {
      email: entry.email ?? null,
      name: entry.name ?? null,
      plan: entry.plan ?? null,
      rateLimitTier: entry.rateLimitTier ?? null,
      uuid: entry.uuid ?? null,
      orgUuid: entry.orgUuid ?? null,
      orgName: entry.orgName ?? null,
      resolvedAt: entry.resolvedAt ?? new Date().toISOString(),
    }

    cache[key] = safeEntry

    const file = accountsCacheFile()
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
    return true
  } catch (err) {
    log(
      'error',
      `writeAccountsCacheEntry: failed to write cache entry for '${instanceDir}': ${String(err)}`,
    )
    return false
  }
}

function accountFromCache(
  instanceDir: string,
  opts: {
    fallbackUuid?: string | null
    fallbackOrgUuid?: string | null
    fallbackPlan?: string | null
    fallbackTier?: string | null
  } = {},
): CMAccount {
  let entry: CMAccountCacheEntry | undefined
  try {
    const cache = readAccountsCache()
    const key = normalizeInstancePath(instanceDir)
    entry = cache[key]
  } catch (err) {
    log('warn', `accountFromCache: failed reading cache for '${instanceDir}': ${String(err)}`)
  }

  // "cache" only when we actually have a cached identity; otherwise "offline" — we resolved
  // nothing but (possibly) some locally-decrypted uuid/tier fragments.
  const status: CMAccount['status'] = entry ? 'cache' : 'offline'

  const email = entry?.email ?? null
  const name = entry?.name ?? null
  const plan = entry?.plan ?? opts.fallbackPlan ?? null
  const rawTier = entry?.rateLimitTier ?? opts.fallbackTier ?? null
  const accountUuid = entry?.uuid ?? opts.fallbackUuid ?? null
  const orgUuid = entry?.orgUuid ?? opts.fallbackOrgUuid ?? null
  const orgName = entry?.orgName ?? null

  const tier = prettyTier(rawTier)
  const label = buildLabel(name, email, tier)

  return newAccount({
    status,
    email,
    name,
    plan,
    rateLimitTier: tier,
    accountUuid,
    orgUuid,
    orgName,
    source: status,
    label,
  })
}

// ----------------------------------------------------------------------------
// Token-cache grant parsing
// ----------------------------------------------------------------------------

interface Grant {
  token: string | null
  expiresAt: number
  subscriptionType: string | null
  rateLimitTier: string | null
  accountUuid: string | null
  orgUuid: string | null
}

interface RawGrantValue {
  expiresAt?: number | string
  subscriptionType?: string
  rateLimitTier?: string
  token?: string
  accessToken?: string
}

/** Picks the grant with the max expiresAt out of the decrypted token-cache JSON's grants map.
 *  Grant keys look like "<accountUuid>:<orgUuid>:https://api.anthropic.com:<scopes...>" — split
 *  into at most 4 pieces so scopes (which may contain further colons/spaces) stay intact as the
 *  last piece. Never throws — malformed entries are skipped. */
function pickBestGrant(decryptedJson: string): Grant | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptedJson)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  let best: Grant | null = null

  for (const [grantKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const value = rawValue as RawGrantValue

    let expiresAt = 0
    try {
      expiresAt =
        typeof value.expiresAt === 'number'
          ? value.expiresAt
          : typeof value.expiresAt === 'string'
            ? Number.parseInt(value.expiresAt, 10) || 0
            : 0
    } catch {
      expiresAt = 0
    }

    if (!best || expiresAt > best.expiresAt) {
      const parts = grantKey.split(':')
      // parts[0] = accountUuid, parts[1] = orgUuid, remainder (rejoined) = "https://api...:<scopes>"
      const accountUuid = parts.length >= 1 ? (parts[0] ?? null) : null
      const orgUuid = parts.length >= 2 ? (parts[1] ?? null) : null

      let token: string | null = null
      try {
        token = typeof value.token === 'string' ? value.token : (value.accessToken ?? null)
      } catch {
        token = null
      }

      best = {
        token,
        expiresAt,
        subscriptionType:
          typeof value.subscriptionType === 'string' ? value.subscriptionType : null,
        rateLimitTier: typeof value.rateLimitTier === 'string' ? value.rateLimitTier : null,
        accountUuid,
        orgUuid,
      }
    }
  }

  return best
}

// ----------------------------------------------------------------------------
// Profile API
// ----------------------------------------------------------------------------

interface ProfileResponse {
  account?: {
    email?: string
    full_name?: string
    uuid?: string
    has_claude_max?: boolean
    has_claude_pro?: boolean
  }
  organization?: {
    uuid?: string
    name?: string
    rate_limit_tier?: string
  }
}

async function fetchProfile(token: string): Promise<ProfileResponse | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(PROFILE_API_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        },
        signal: controller.signal,
      })
      if (!res.ok) {
        log('warn', `fetchProfile: profile API responded ${res.status}`)
        return null
      }
      const json = (await res.json()) as ProfileResponse
      return json
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    // Covers network errors, DNS failure, timeout/abort, malformed JSON, etc.
    log('warn', `fetchProfile: request failed: ${String(err)}`)
    return null
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface ResolveAccountOptions {
  /** If set, never calls the profile API — always resolves from local decryption + our own
   *  cache only (`?noNetwork=1`). */
  noNetwork?: boolean
}

/**
 * Resolves the real account identity (email/name/plan/rate-limit tier) that an isolated
 * Claude Desktop instance is logged into, with graceful offline/cache fallback. Never throws.
 */
export async function resolveAccount(
  instanceDir: string,
  options: ResolveAccountOptions = {},
): Promise<CMAccount> {
  try {
    if (!instanceDir?.trim()) {
      log('warn', 'resolveAccount: instanceDir is null/empty.')
      return newAccount({ status: 'unknown', label: '(not logged in / unreadable)' })
    }

    const configPath = path.join(instanceDir, 'config.json')

    // ---- Step 1: cheap pre-check --------------------------------------------------------
    let config: Record<string, unknown> | null = null
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf8')
        if (raw?.trim()) config = JSON.parse(raw) as Record<string, unknown>
      } catch (err) {
        log(
          'warn',
          `resolveAccount: failed to read/parse config.json at '${configPath}': ${String(err)}`,
        )
        config = null
      }
    }

    const lastKnownAccountUuid =
      config && typeof config.lastKnownAccountUuid === 'string' ? config.lastKnownAccountUuid : null

    if (!config || !lastKnownAccountUuid) {
      log(
        'info',
        `resolveAccount: no config.json / lastKnownAccountUuid for '${instanceDir}' — logged out.`,
      )
      return newAccount({ status: 'loggedout', label: '(not logged in)' })
    }

    // ---- Step 2: decrypt the token cache (v2, falling back to v1) -----------------------
    let tokenCacheB64: string | null = null
    let usedV1 = false
    if (typeof config['oauth:tokenCacheV2'] === 'string' && config['oauth:tokenCacheV2']) {
      tokenCacheB64 = config['oauth:tokenCacheV2'] as string
    } else if (typeof config['oauth:tokenCache'] === 'string' && config['oauth:tokenCache']) {
      tokenCacheB64 = config['oauth:tokenCache'] as string
      usedV1 = true
    }

    let bestGrant: Grant | null = null

    if (tokenCacheB64) {
      let decrypted: string | null = null
      try {
        decrypted = await decryptSafeStorage(tokenCacheB64, instanceDir)
      } catch (err) {
        log('warn', `resolveAccount: decryptSafeStorage threw for '${instanceDir}': ${String(err)}`)
        decrypted = null
      }

      if (decrypted) {
        bestGrant = pickBestGrant(decrypted)
      } else {
        log(
          'warn',
          `resolveAccount: could not decrypt token cache (${usedV1 ? 'v1' : 'v2'}) for '${instanceDir}'.`,
        )
      }
    } else {
      log(
        'info',
        `resolveAccount: no oauth token cache (v1 or v2) present in config.json for '${instanceDir}'.`,
      )
    }

    // ---- Step 3: decide whether to go live or fall back ----------------------------------
    const nowMs = Date.now()
    const expiresAt = bestGrant?.expiresAt ?? 0
    const expired = expiresAt <= 0 || expiresAt < nowMs
    const token = bestGrant?.token ?? null
    const haveToken = Boolean(token?.trim())

    if (options.noNetwork || !haveToken || expired) {
      const reason = options.noNetwork
        ? 'noNetwork requested'
        : !haveToken
          ? 'no usable access token decrypted'
          : 'access token expired'
      log('info', `resolveAccount: resolving '${instanceDir}' from cache/offline (${reason}).`)

      return accountFromCache(instanceDir, {
        fallbackUuid: bestGrant?.accountUuid ?? lastKnownAccountUuid,
        fallbackOrgUuid: bestGrant?.orgUuid ?? null,
        fallbackPlan: bestGrant?.subscriptionType ?? null,
        fallbackTier: bestGrant?.rateLimitTier ?? null,
      })
    }

    // ---- Step 4: live profile call --------------------------------------------------------
    const profile = await fetchProfile(token as string)
    // Token was only ever held in this local `token`/`bestGrant` binding; nothing persists it.

    if (!profile) {
      log('warn', `resolveAccount: profile API call failed for '${instanceDir}'.`)
      return accountFromCache(instanceDir, {
        fallbackUuid: bestGrant?.accountUuid ?? lastKnownAccountUuid,
        fallbackOrgUuid: bestGrant?.orgUuid ?? null,
        fallbackPlan: bestGrant?.subscriptionType ?? null,
        fallbackTier: bestGrant?.rateLimitTier ?? null,
      })
    }

    const email = profile.account?.email ?? null
    const fullName = profile.account?.full_name ?? null
    const accountUuid = profile.account?.uuid ?? bestGrant?.accountUuid ?? lastKnownAccountUuid
    const orgUuid = profile.organization?.uuid ?? bestGrant?.orgUuid ?? null
    const orgName = profile.organization?.name ?? null
    const rawTier = profile.organization?.rate_limit_tier ?? bestGrant?.rateLimitTier ?? null

    let plan = bestGrant?.subscriptionType ?? null
    if (profile.account?.has_claude_max) plan = 'max'
    else if (profile.account?.has_claude_pro) plan = 'pro'

    const tier = prettyTier(rawTier)
    const label = buildLabel(fullName, email, tier)

    // Write identity ONLY (never the token) to the cache.
    writeAccountsCacheEntry(instanceDir, {
      email,
      name: fullName,
      plan,
      rateLimitTier: rawTier,
      uuid: accountUuid,
      orgUuid,
      orgName,
      resolvedAt: new Date().toISOString(),
    })

    log('info', `resolveAccount: resolved '${instanceDir}' live -> ${label}`)

    return newAccount({
      status: 'live',
      email,
      name: fullName,
      plan,
      rateLimitTier: tier,
      accountUuid,
      orgUuid,
      orgName,
      source: 'live',
      label,
    })
  } catch (err) {
    log('error', `resolveAccount: unexpected error for '${instanceDir}': ${String(err)}`)
    return newAccount({ status: 'unknown', label: '(not logged in / unreadable)' })
  }
}
