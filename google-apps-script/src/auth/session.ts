/**
 * Token revocation.
 *
 * See IMPLEMENTATION_PLAN.md §18.3.
 *
 * Tokens are stateless, so logging out means recording the token id (`jti`) as
 * revoked until it would have expired anyway.
 *
 * Stored in Script Properties rather than CacheService: the cache caps entries
 * at 6 hours while a token lives for 8, so a cached revocation could silently
 * lapse and let a "logged out" token work again for the final two hours.
 * Script Properties has no such ceiling. The map is pruned on every write, so
 * it stays a handful of entries for a team of this size.
 */

const REVOCATION_PROPERTY = 'REVOKED_TOKEN_IDS';

type RevocationMap = Record<string, number>;

function store(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getScriptProperties();
}

function readMap(): RevocationMap {
  const raw = store().getProperty(REVOCATION_PROPERTY);
  if (raw === null || raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const map: RevocationMap = {};
    for (const key of Object.keys(parsed)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        map[key] = value;
      }
    }
    return map;
  } catch {
    // A corrupt property must not lock everyone out; treat it as empty and
    // let the next write replace it.
    return {};
  }
}

function prune(map: RevocationMap, now: number): RevocationMap {
  const pruned: RevocationMap = {};
  for (const jti of Object.keys(map)) {
    const expiry = map[jti];
    if (expiry !== undefined && expiry > now) {
      pruned[jti] = expiry;
    }
  }
  return pruned;
}

/** Revoke a token id until `expiresAt` (epoch seconds), pruning lapsed entries. */
export function revokeToken(jti: string, expiresAt: number, now: number): void {
  const map = prune(readMap(), now);
  map[jti] = expiresAt;
  store().setProperty(REVOCATION_PROPERTY, JSON.stringify(map));
}

export function isTokenRevoked(jti: string, now: number): boolean {
  const expiry = readMap()[jti];
  return expiry !== undefined && expiry > now;
}

/** Test and maintenance helper. */
export function clearRevocations(): void {
  store().deleteProperty(REVOCATION_PROPERTY);
}
