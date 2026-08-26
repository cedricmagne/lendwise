import type { Backstop, Emissions } from '@blend-capital/blend-sdk'
import { FixedMath, Version } from '@blend-capital/blend-sdk'

import type { Kind } from '@/lib/db/types'

export function buildProductId({
  poolId,
  assetId,
  kind,
  version = Version.V1,
}: {
  poolId: string
  assetId: string
  kind: Kind
  version?: Version
}): string {
  return `blend:${version.toLowerCase()}:stellar:pool:${poolId.toLowerCase()}:${assetId.toLowerCase()}:${kind}`
}

/**
 * BLND has no oracle feed of its own — it's never a reserve asset, only the
 * emitted reward token — so its USD price has to come from the backstop's
 * BLND/USDC Comet pool instead of `getPoolPrices`.
 *
 * `backstopToken.lpTokenPrice` already values one LP share in USD assuming
 * USDC = $1 and the pool's fixed 80/20 (BLND/USDC) weights baked into the SDK
 * (`usdc * 5`, i.e. `usdc / 0.2`). Subtracting the USDC leg's own USD value
 * (`usdcPerLpToken`) leaves the BLND leg's USD value per share; dividing by
 * `blndPerLpToken` gives the BLND price itself.
 *
 * Returns `null` when the backstop token hasn't loaded (no BLND to price
 * against).
 */
export function getBlndPriceUsd(backstop: Backstop): number | null {
  const { blndPerLpToken, usdcPerLpToken, lpTokenPrice } =
    backstop.backstopToken
  if (!blndPerLpToken) return null
  return (lpTokenPrice - usdcPerLpToken) / blndPerLpToken
}

/**
 * Converts a reserve's raw emission data into an APR, in the same units as
 * `reserve.supplyApr`/`borrowApr` — a fraction of the underlying asset's
 * value, ready to feed `aprToApyDaily`.
 *
 * `emissions.emissionsPerYearPerToken` (blend-sdk) already annualizes BLND
 * per unit of b/dToken; from there this is a straight value conversion:
 * BLND/year/token · BLND price, divided by one token's underlying value
 * (`rate · assetPrice`, since a b/dToken isn't 1:1 with the underlying).
 *
 * Returns 0 — never null — when emissions are absent/expired or a price is
 * unknown: "no reward APR" is the correct claim in both cases, unlike the
 * market-size fields where 0 vs unknown matters (see BorrowMarketState).
 */
export function computeEmissionsApr({
  emissions,
  supply,
  decimals,
  rate,
  rateDecimals,
  blndPriceUsd,
  assetPriceUsd,
}: {
  emissions: Emissions | undefined
  supply: bigint
  decimals: number
  rate: bigint
  rateDecimals: number
  blndPriceUsd: number | null
  assetPriceUsd: number | null
}): number {
  if (!emissions || blndPriceUsd == null || assetPriceUsd == null) return 0

  const blndPerTokenPerYear = emissions.emissionsPerYearPerToken(
    supply,
    decimals
  )
  if (blndPerTokenPerYear === 0) return 0

  const rateFloat = FixedMath.toFloat(rate, rateDecimals)
  if (rateFloat === 0 || assetPriceUsd === 0) return 0

  return (blndPerTokenPerYear * blndPriceUsd) / (rateFloat * assetPriceUsd)
}
