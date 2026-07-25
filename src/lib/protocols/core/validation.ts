import { z } from 'zod'

/**
 * Two severities, two rule sets (spec §6, amended):
 *
 * - SOFT (runtime, collector + products-sync): shape + finiteness only. A payload
 *   failing it is logged and skipped; the slot never crashes. It must NOT bound
 *   magnitude — dropping a finite extreme rate at ingestion manufactures the gap
 *   that heal then fills with the same value unguarded (see lib/apy-validation.ts).
 * - STRICT (CI harness): soft rules + |net| < 10 (1000%) + chainId declared by the
 *   adapter. A brand-new community adapter quoting >1000% is almost always a unit
 *   bug (raw percentage vs decimal), and CI is where that must die. One exemption:
 *   a market at ~full utilization legitimately quotes the protocol's rate-curve
 *   maximum (drained Morpho markets hit ~298,000% APY), so the magnitude bound
 *   skips markets at utilization >= 0.999.
 */

// z.number() in zod 4 already rejects NaN and ±Infinity; `.finite()` is a no-op
// kept for intent. Finiteness is the ONE guarantee both severities share.
const finite = z.number().finite()

const rewardItemSchema = z.object({
  token: z.object({ symbol: z.string(), address: z.string() }),
  apr: finite,
  apy: finite,
  source: z.string(),
  program: z.unknown().nullable(),
})

const apyBlockSchema = z.object({
  base: finite,
  rewards: finite,
  fees: finite,
  net: finite,
  rewardItems: z.array(rewardItemSchema),
})

export const spotPayloadSoftSchema = z.object({
  productId: z.string().min(1),
  kind: z.enum(['supply', 'borrow']),
  protocol: z.string().min(1),
  chainId: z.number().int().positive(),
  asset: z.string().min(1),
  apy: apyBlockSchema,
  market: z.record(z.string(), z.unknown()),
})

/**
 * Utilization above which the magnitude bound is waived. Live drained Morpho
 * markets report 0.9999997… (dust of liquidity left), not exactly 1, so an
 * equality check misses them; anywhere this close to full the rate curve's
 * genuine maximum applies.
 */
const DRAINED_UTILIZATION = 0.999

/**
 * How far `amount × price` may sit from the reported USD value.
 *
 * Deliberately loose. The fault this catches is not a rounding drift, it is a
 * factor of 10^decimals — Compound and Morpho passed their protocols' RAW base
 * units straight through while Aave passed human ones, so one column carried
 * two different units with nothing saying which. Morpho compounded it by
 * deriving `assetPriceUsd = totalAssetsUsd / totalAssets` from the raw amount,
 * putting every Morpho price at ~1e-15 and, through the cross-provider price
 * fallback, halving the USD values the Aave backfill derived.
 *
 * A 5% band leaves ample room for a stale price or a mid-slot balance change,
 * and still fails by six to eighteen orders of magnitude on a unit bug.
 */
const AMOUNT_PRICE_TOLERANCE = 0.05

/** A finite, strictly positive number — the only case worth cross-checking. */
function usable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * `amount × price ≈ amountUsd`, when all three are known.
 *
 * Returns true whenever the check does not apply: an unpriced asset, an empty
 * market, or a protocol that publishes no amounts at all. NULL means unknown
 * here as everywhere — an absent value is never a failure.
 */
function amountAgreesWithUsd(
  amount: unknown,
  price: unknown,
  amountUsd: unknown
): boolean {
  if (!usable(amount) || !usable(price) || !usable(amountUsd)) return true
  const expected = amount * price
  return Math.abs(expected - amountUsd) / amountUsd <= AMOUNT_PRICE_TOLERANCE
}

export function spotPayloadStrictSchema(chainIds: number[]) {
  return spotPayloadSoftSchema
    .refine(
      (p) =>
        amountAgreesWithUsd(
          p.market.supplyAssets,
          p.market.assetPriceUsd,
          p.market.supplyAssetsUsd
        ),
      {
        message:
          'supplyAssets × assetPriceUsd disagrees with supplyAssetsUsd — ' +
          'amounts must be in WHOLE TOKEN units (raw ÷ 10^decimals)',
      }
    )
    .refine(
      (p) =>
        amountAgreesWithUsd(
          p.market.borrowAssets,
          p.market.assetPriceUsd,
          p.market.borrowAssetsUsd
        ),
      {
        message:
          'borrowAssets × assetPriceUsd disagrees with borrowAssetsUsd — ' +
          'amounts must be in WHOLE TOKEN units (raw ÷ 10^decimals)',
      }
    )
    .refine(
      // Drained-market exemption: at ~full utilization a protocol's rate curve
      // quotes its genuine maximum (Morpho borrow ~298,000% APY) — real market
      // state, not a unit bug. A unit bug inflates rates across the board, not
      // exclusively on fully-utilized markets, so the bound still catches it.
      (p) => {
        if (Math.abs(p.apy.net) < 10) return true
        const util = p.market.utilizationRate
        return typeof util === 'number' && util >= DRAINED_UTILIZATION
      },
      { message: 'net APY magnitude >= 10 (1000%) — probable unit bug' }
    )
    .refine(
      // Absolute price floor — the ONE check that catches the Morpho price bug.
      //
      // The coherence checks above are blind to it: Morpho derived its price as
      // totalAssetsUsd / totalAssets with a RAW denominator, so the price came
      // out 10^decimals too SMALL while the amount was 10^decimals too LARGE —
      // the two errors cancel, and `amount × price ≈ amountUsd` holds either
      // way. Only the absolute scale gives it away: a broken WETH price is
      // ~1.9e-15, a broken USDC price ~1e-6.
      //
      // The broken price is `correct / 10^decimals`, so it ranges from ~1.9e-15
      // (WETH, 18 dec) up to ~1e-6 (a 6-decimal stablecoin — the shallowest
      // case, and the one a 1e-9 floor missed). No real asset in a lending
      // market at scale is priced below a millionth of a dollar, so 1e-6 catches
      // every broken case and effectively never fires on a genuine price. NULL
      // is unknown, not a failure.
      (p) => {
        const price = p.market.assetPriceUsd
        if (typeof price !== 'number' || price === 0) return true
        return price >= 1e-6
      },
      {
        message:
          'assetPriceUsd < 1e-6 — price derived from a RAW amount ' +
          '(divide the amount by 10^decimals before deriving)',
      }
    )
    .refine((p) => chainIds.includes(p.chainId), {
      message: 'chainId not declared in adapter.chains',
    })
}

/**
 * Validates a product emitted by `YieldAdapter.getProducts()` — i.e. the DB
 * `SupplyProduct`/`BorrowProduct` domain shape (src/lib/db/types.ts), where
 * provider/version/name are NESTED under `protocol`, not top-level. The interface
 * calls for "shape + provider/version coherence": those two literals hold because
 * `protocol.provider`/`protocol.version` are the columns the adapter fills.
 *
 * `adapter.id` (the registry key, e.g. "aave_v3") is intentionally NOT bound to a
 * product field: the domain object's `protocol.name` is the native per-market name
 * ("AaveV3Ethereum", varies within one adapter), so an adapter-level literal cannot
 * constrain it. It stays a plain shape check. `.loose()` lets every other real
 * field (asset, chain, meta, timestamps, …) pass through untouched.
 */
export function productStrictSchema(adapter: {
  id: string
  provider: string
  version: string
}) {
  return z
    .object({
      _id: z.string().min(1),
      kind: z.enum(['supply', 'borrow']),
      protocol: z
        .object({
          provider: z.literal(adapter.provider),
          version: z.literal(adapter.version),
          name: z.string().min(1),
        })
        .loose(),
    })
    .loose()
}
