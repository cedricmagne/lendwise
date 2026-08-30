import type { FetchOpts } from '@/lib/protocols/core/types'

import { getFactoryDeployedPools } from './common/api'

/**
 * De-dupe (case-insensitive) and sort. OUTPUT is always UPPERCASE strkey:
 * `Address.fromString` (Stellar SDK) rejects the lowercase form, and these ids
 * flow straight into `PoolV{1,2}.load`. De-dup rule preserved from the earlier
 * discovery module.
 */
function dedupeUpper(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.toUpperCase()))].sort()
}

/**
 * blendPoolIds — the one pool-id set, for every Blend caller.
 *
 * Blend has no on-chain enumeration (the factory has is_pool/deploy only, no
 * get_pools; blend-sdk 3.3.0 ships no PoolFactoryV2 reader — verified
 * 2026-08-29). The ONLY on-chain source is the factory's Deploy events, and the
 * RPC retains ~7 days of them. So the caller (pipeline) injects the KNOWN set
 * from the `products` catalogue via opts.poolIds — same shape as
 * getApyHistory(targets) — and this module unions it, for getProducts only,
 * with a fresh factory scan.
 *
 *   getProducts (mode 'catalogue') = known ∪ getEvents(7d)
 *     — catch a pool minted this week before it lands in `products`
 *   getApySpot  (mode 'spot')      = known only
 *     — the catalogue is authoritative for what to collect; a pool we collect
 *       but never catalogue writes orphan apy_hourly rows (the aave war story
 *       in aave/v3/listing.ts, the dangerous direction). A brand-new pool is
 *       catalogued by the hourly sync and collected on the next 10-min tick;
 *       the only observable gap is a ≤1h window right after a deploy, for a
 *       pool younger than 7 days.
 */
export async function blendPoolIds(
  version: 'v1' | 'v2',
  opts: FetchOpts | undefined,
  mode: 'catalogue' | 'spot'
): Promise<string[]> {
  const known = opts?.poolIds ?? []

  if (mode === 'spot') return dedupeUpper(known)

  // getProducts only: union the known set with a fresh factory Deploy scan.
  // ANY failure — a refusal or a malformed event — degrades to `[]` and the
  // union proceeds on `known` alone. Nothing corrupt is written; a missed
  // brand-new pool self-heals via `enumerate`'s retry or the next hourly run.
  // So, unlike `getPoolPrices`, a refusal here must NOT abort the sync.
  const fresh = await getFactoryDeployedPools(version).catch((e) => {
    console.warn(
      `[pools:blend_${version}] getEvents skipped: ` +
        `${e instanceof Error ? e.message : e}`
    )
    return [] as string[]
  })

  return dedupeUpper([...known, ...fresh])
}
