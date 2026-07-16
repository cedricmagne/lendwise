import { aprToApyDaily } from '@/lib/utils'

// ─── Merkl types ──────────────────────────────────────────────────────────────

type MerklOpportunity = {
  chainId: number
  status: string
  action: string
  apr: number
  depositUrl?: string
  tokens: { address: string }[]
}

export type MerklIncentiveMap = Map<string, { apr: number; apy: number }>

export type MerklIncentives = {
  supply: MerklIncentiveMap
  borrow: MerklIncentiveMap
}

// ─── Merkl helpers ────────────────────────────────────────────────────────────

function extractDepositUrlParams(depositUrl?: string): {
  marketName: string | null
  underlyingAsset: string | null
} {
  if (!depositUrl) return { marketName: null, underlyingAsset: null }
  try {
    const url = new URL(depositUrl)
    return {
      marketName: url.searchParams.get('marketName'),
      underlyingAsset: url.searchParams.get('underlyingAsset'),
    }
  } catch {
    return { marketName: null, underlyingAsset: null }
  }
}

function incentiveKey(marketName: string | null, tokenAddress: string): string {
  const addr = tokenAddress.toLowerCase()
  return marketName ? `${marketName}:${addr}` : addr
}

/**
 * Fetch Merkl incentive APRs for AAVE opportunities (LEND + BORROW).
 * Returns maps of composite key (marketName:tokenAddress) → { apr, apy }.
 * Merkl APR values are raw percentage (e.g. 1.5 = 1.5%) — converted to decimal APY.
 */
export async function fetchMerklIncentives(opts: {
  name: string
  chainIds: number[]
  logPrefix?: string
}): Promise<MerklIncentives> {
  const logPrefix = `[${opts.logPrefix ?? opts.name}:merkl]`
  const incentives: MerklIncentives = {
    supply: new Map(),
    borrow: new Map(),
  }

  try {
    const url = `https://api.merkl.xyz/v4/opportunities/?name=${encodeURIComponent(opts.name)}&chainId=${opts.chainIds.join(',')}`
    const response = await fetch(url)

    if (!response.ok) {
      console.warn(
        `${logPrefix} API returned ${response.status}: ${response.statusText}`
      )
      return incentives
    }

    const opportunities: MerklOpportunity[] = await response.json()

    for (const opp of opportunities) {
      if (opp.status !== 'LIVE') continue

      const targetMap =
        opp.action === 'LEND'
          ? incentives.supply
          : opp.action === 'BORROW'
            ? incentives.borrow
            : null

      if (!targetMap) continue

      // Merkl returns APR as a percentage — convert to decimal APY
      const aprDecimal = opp.apr / 100
      const apy = aprToApyDaily(aprDecimal)

      const { marketName, underlyingAsset } = extractDepositUrlParams(
        opp.depositUrl
      )
      // Some Merkl campaigns (Aave V4 hub/spoke, cross-market "Dutch" campaigns)
      // don't carry a marketName — we can't safely attribute those to a single
      // V3 market instance, so skip rather than risk misattributing rewards
      // across markets/versions that happen to share a token address.
      if (!marketName) continue

      const addresses = new Set(opp.tokens.map((t) => t.address.toLowerCase()))
      if (underlyingAsset) addresses.add(underlyingAsset.toLowerCase())

      for (const addr of addresses) {
        const key = incentiveKey(marketName, addr)
        const current = targetMap.get(key)
        targetMap.set(key, {
          apr: (current?.apr ?? 0) + aprDecimal,
          apy: (current?.apy ?? 0) + apy,
        })
      }
    }
  } catch (err) {
    console.error(
      `${logPrefix} Failed to fetch Merkl incentives:`,
      err instanceof Error ? err.message : err
    )
  }

  return incentives
}

export function lookupMerklIncentive(
  map: MerklIncentiveMap,
  marketSlug: string | null,
  tokenAddress: string
): { apr: number; apy: number } | null {
  if (!marketSlug) return null
  return map.get(`${marketSlug}:${tokenAddress.toLowerCase()}`) ?? null
}
