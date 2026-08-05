/**
 * @file from-catalogue.ts
 * Presentation: a catalogue row + its latest observation → a table product.
 *
 * This replaces the adapter call at render time. Fields the protocol used to
 * supply — pool name, link, liquidity — are now derived from typed columns of
 * `products` and `apy_hourly`, so the table can no longer show a row the
 * pipeline doesn't know about.
 *
 * Pure, no DB import: testable without DATABASE_URL, and without network.
 */
import type { Address } from 'viem'

import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import type { ApyEnrichment } from '@/lib/db/repositories/apy'
import type { ProductRow } from '@/lib/db/schema'
import type { CatalogueRow, Collateral } from '@/lib/db/types'
import { getNetworkName } from '@/lib/protocols/aave/v3/utils'
import { SLUG_MAPPING } from '@/lib/protocols/compound/v3/utils'
import {
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
} from '@/lib/protocols/core/toolkit'
import { generateSlug } from '@/lib/utils'
import type { BorrowProduct, SupplyProduct, Token } from '@/types'

/** `provider` + `version` — the key of both adapter registries. */
export function adapterId(p: ProductRow): ProtocolName {
  return `${p.provider}_${p.version}` as ProtocolName
}

/**
 * The canonical slug, or `undefined` if `chainId` isn't (yet) in
 * `CHAIN_SLUG_MAP`. `p.chainId` is only `as`-cast to `RegisteredChainId` —
 * nothing statically guarantees it's a member — hence this lookup, which
 * fails cleanly instead of returning an entry that doesn't exist.
 */
function registeredChainSlug(p: ProductRow): string | undefined {
  return CHAIN_SLUG_MAP[p.chainId as RegisteredChainId]
}

/**
 * The canonical chain slug, derived from `chainId` alone — never from a
 * display name. Used by `networkSlug()` (outside Aave), where a missing entry
 * must surface loudly: `network` is a required field of the table, and an
 * unregistered chain there is a configuration bug to fix, not a case to mask.
 */
function chainIdSlug(p: ProductRow): string {
  const slug = registeredChainSlug(p)
  if (!slug)
    throw new Error(
      `No slug registered for chainId ${p.chainId} — add it to chain-slugs.ts`
    )
  return slug
}

/**
 * The table's `network` field.
 *
 * General rule: the canonical chain slug, by chainId. The exception is Aave,
 * whose UI presents Lido, EtherFi and Horizon as distinct "networks" though
 * they all sit on Ethereum — so the slug comes from the market name instead,
 * exactly as the adapter does.
 */
export function networkSlug(p: ProductRow): string {
  if (p.provider === PROTOCOLS_META.aave_v3.provider)
    return getNetworkName(p.protocolName)
  return chainIdSlug(p)
}

/**
 * The displayed name. Aave and Compound name the pool after its asset; Morpho
 * names the vault (its own name, kept in `meta` at sync time) and the market
 * after its loan/collateral pair.
 */
export function poolName(p: ProductRow): string {
  if (p.provider !== PROTOCOLS_META.morpho_v1.provider) return p.assetName
  if (p.kind === 'supply') {
    return (p.meta as { name?: string }).name ?? p.assetName
  }
  const collateral = (p.collaterals as { symbol: string }[] | null)?.[0]?.symbol
  return collateral ? `${p.assetSymbol}/${collateral}` : p.assetSymbol
}

/**
 * `poolId` and `poolAddress`. They coincide with the protocol address
 * everywhere except a Morpho market, identified by its marketId while its
 * address is that of the loaned asset.
 */
export function poolIdentity(p: ProductRow): {
  poolId: string
  poolAddress: Address
} {
  if (p.provider === PROTOCOLS_META.morpho_v1.provider && p.kind === 'borrow') {
    return {
      poolId: (p.meta as { id: string }).id,
      poolAddress: p.assetAddress as Address,
    }
  }
  return {
    poolId: p.protocolAddress,
    poolAddress: p.protocolAddress as Address,
  }
}

/**
 * The link to the protocol's app — one template per provider.
 *
 * Aave and Morpho use `registeredChainSlug(p)`, not `p.chainName`: that
 * column holds the source protocol's DISPLAY name, which sometimes contains a
 * space (measured in the catalogue: `chain_id` 196 → `"X Layer"` on Aave,
 * 10 → `"op mainnet"` and 42161 → `"arbitrum one"` on Morpho) — building a
 * URL from it breaks it (unencoded space). 9 Aave products (X Layer) and 5
 * Morpho ones (Optimism, Arbitrum) rendered a broken link before this fix.
 *
 * Deliberately `registeredChainSlug()` rather than `networkSlug()` for Aave:
 * the latter distinguishes Lido/EtherFi/Horizon by `protocolName` for the
 * UI's `network` field (the documented exception), but those markets have no
 * eligible row in the catalogue as of this fix — so parity cannot confirm
 * which token the adapter actually expects there. `registeredChainSlug()`
 * leaves their link unchanged (`ethereum`, as before) rather than inventing
 * an unverified slug.
 *
 * And deliberately `registeredChainSlug()` (which returns `undefined`) rather
 * than `chainIdSlug()` (which throws) on both the Aave and Morpho branches: a
 * broken link must never fail the entire `/supply` load for one product — see
 * the comment on each branch.
 */
export function productLink(p: ProductRow): string {
  switch (p.provider) {
    case PROTOCOLS_META.aave_v3.provider: {
      // `registeredChainSlug()`, not `chainIdSlug()`: a link is decorative,
      // not a required field of the table. A chainId that drifts from the
      // registry (a new market added to AAVE_V3_CHAINS before it's registered
      // in chain-slugs.ts) should only cost a missing icon, not crash all of
      // `/supply` — see the `default:` case right below, which already
      // degrades the same way for an unknown provider.
      const slug = registeredChainSlug(p)
      if (!slug) return ''
      return `https://app.aave.com/reserve-overview/?underlyingAsset=${p.assetAddress.toLowerCase()}&marketName=proto_${slug}_v3`
    }
    case PROTOCOLS_META.compound_v3.provider:
      return `https://app.compound.finance/?market=${p.assetSymbol.toLowerCase()}-${SLUG_MAPPING[p.chainId] ?? 'mainnet'}`
    case PROTOCOLS_META.morpho_v1.provider: {
      // Same degradation as the Aave branch above, same reason.
      const slug = registeredChainSlug(p)
      if (!slug) return ''
      return p.kind === 'supply'
        ? `https://app.morpho.org/${slug}/vault/${p.protocolAddress}/${generateSlug(poolName(p))}`
        : `https://app.morpho.org/${slug}/market/${(p.meta as { id: string }).id}`
    }
    default:
      return ''
  }
}

/**
 * `apy_hourly` stores WHOLE tokens; the table type carries RAW units in a
 * string, which the UI re-divides by `10 ** assetDecimals`. The conversion
 * costs decimals beyond the fifteenth significant digit of a
 * `double precision` — invisible at render time, which never shows more than
 * six.
 */
export function toRawUnits(whole: number | null, decimals: number): string {
  if (whole == null || !Number.isFinite(whole) || whole <= 0) return '0'
  return BigInt(Math.round(whole * 10 ** decimals)).toString()
}

/**
 * Liquidity is what isn't borrowed — one formula covers all three providers,
 * because all three define utilization as the deployed share: Aave
 * `borrowUsd / supplyUsd`, Compound `totalBorrow / totalSupply`, Morpho
 * `(total − withdrawable) / total`.
 *
 * A supply product has no `borrow_assets` column — it's null by construction
 * in `apy_hourly` — so the subtraction the adapter does isn't available here,
 * and the utilization rate replaces it exactly.
 *
 * Unknown utilization = 0: shows the full deposit, which is the conservative
 * read of a market whose borrow side is unknown.
 */
export function liquidity(
  supply: number | null,
  utilization: number | null
): number {
  if (supply == null || !Number.isFinite(supply)) return 0
  const u =
    utilization == null || !Number.isFinite(utilization)
      ? 0
      : Math.min(Math.max(utilization, 0), 1)
  // `supply - supply * u` rather than `supply * (1 - u)`: mathematically
  // identical, but avoids the floating-point error of `1 - u` (0.8 becomes
  // 0.19999999999999996), which drifted 1,000,000 at 80% utilization to
  // 199999.99999999994.
  return supply - supply * u
}

/**
 * The full table row. `apy` ALWAYS comes from the standardized observation:
 * there is no protocol value left to fall back to, so no zero is displayed as
 * if it had been measured.
 *
 * The horizon averages default to the row's own: `latestForTable` joins them
 * in, so a `CatalogueRow` already satisfies `ApyEnrichment` structurally and
 * the caller has nothing to pass. The explicit parameter remains for a caller
 * that computed them separately — the borrow path, until it migrates, and the
 * fixtures that exercise the two independently.
 */
export function toSupplyProduct(
  row: CatalogueRow,
  e: ApyEnrichment = row
): SupplyProduct {
  const p = row.product
  const { poolId, poolAddress } = poolIdentity(p)
  const supplyUsd = row.supplyAssetsUsd ?? 0
  return {
    protocol: adapterId(p),
    network: networkSlug(p),
    poolName: poolName(p),
    poolId,
    poolAddress,
    poolChainId: p.chainId,
    assetAddress: p.assetAddress as Address,
    assetName: p.assetName,
    assetSymbol: p.assetSymbol,
    assetDecimals: p.assetDecimals,
    assetAmount: toRawUnits(row.supplyAssets, p.assetDecimals),
    assetAmountUsd: supplyUsd,
    assetPriceUsd: row.assetPriceUsd ?? undefined,
    liquidityAmount: toRawUnits(
      liquidity(row.supplyAssets, row.utilizationRate),
      p.assetDecimals
    ),
    liquidityAmountUsd: liquidity(supplyUsd, row.utilizationRate),
    apy: row.apyNet,
    apyRewards: row.apyRewards,
    apyDaily: e?.apyDaily,
    apyMonthly: e?.apyMonthly,
    apyYearly: e?.apyYearly,
    apyRewardsDaily: e?.apyRewardsDaily,
    apyRewardsMonthly: e?.apyRewardsMonthly,
    apyRewardsYearly: e?.apyRewardsYearly,
    productId: p.id,
    link: productLink(p),
  }
}

/**
 * `products.collaterals` — always non-empty on a borrow product — narrowed
 * from `Collateral[]` (the jsonb shape written at sync time, see
 * `repositories/products.ts`) to `Token[]` (what the table type carries).
 * They agree field-for-field except `logoURI` / `type`, which no adapter's
 * borrow-products.ts populates either — the icon resolves at render time from
 * `assetSymbol`, not from this list.
 */
function collateralTokens(p: ProductRow): Token[] {
  const collaterals = (p.collaterals as Collateral[] | null) ?? []
  return collaterals.map((c) => ({
    address: c.address as Address,
    symbol: c.symbol,
    name: c.name,
    decimals: c.decimals,
    ltv: c.ltv,
    lltv: c.lltv,
  }))
}

/**
 * The borrow table row. Mirrors `toSupplyProduct` field for field — same
 * presentation helpers, same catalogue row — with two differences that come
 * from what a borrow product actually is:
 *
 *   - `assetAmount(Usd)` and `liquidityAmount(Usd)` read `row.supplyAssets` /
 *     `row.supplyAssetsUsd`, not a borrowed amount. Every adapter's
 *     borrow-products.ts does the same (verified in aave/v3, morpho/v1,
 *     compound/v3): the "amount" column on `/borrow` is the market's total
 *     deposits, i.e. how deep the pool is — apy is what's borrow-specific.
 *   - No `apyRewards*` fields: `BorrowProduct` carries no reward columns
 *     (unlike `SupplyProduct`), because a borrow rate is a cost, not a yield
 *     rewards can offset.
 */
export function toBorrowProduct(
  row: CatalogueRow,
  e: ApyEnrichment = row
): BorrowProduct {
  const p = row.product
  const { poolId, poolAddress } = poolIdentity(p)
  const supplyUsd = row.supplyAssetsUsd ?? 0
  return {
    protocol: adapterId(p),
    network: networkSlug(p),
    poolName: poolName(p),
    poolId,
    poolAddress,
    poolChainId: p.chainId,
    assetAddress: p.assetAddress as Address,
    assetName: p.assetName,
    assetSymbol: p.assetSymbol,
    assetDecimals: p.assetDecimals,
    assetAmount: toRawUnits(row.supplyAssets, p.assetDecimals),
    assetAmountUsd: supplyUsd,
    liquidityAmount: toRawUnits(
      liquidity(row.supplyAssets, row.utilizationRate),
      p.assetDecimals
    ),
    liquidityAmountUsd: liquidity(supplyUsd, row.utilizationRate),
    collaterals: collateralTokens(p),
    apy: row.apyNet,
    apyDaily: e?.apyDaily,
    apyMonthly: e?.apyMonthly,
    apyYearly: e?.apyYearly,
    productId: p.id,
    link: productLink(p),
  }
}
