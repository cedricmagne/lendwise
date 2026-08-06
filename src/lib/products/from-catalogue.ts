/**
 * Presentation: a catalogue row + its latest observation → a table product.
 *
 * This replaces the adapter call at render time. Fields the protocol used to
 * supply — pool name, link, liquidity — are now derived from typed columns of
 * `products` and `apy_hourly`, so the table can no longer show a row the
 * pipeline doesn't know about.
 *
 * Pure, no DB import: testable without DATABASE_URL, and without network.
 *
 * No provider is named here. Everything protocol-specific — the pool label, the
 * network, the identity, the link — is a hook each adapter registers in
 * `@/config/protocols-presentation`; this file resolves hook-or-default. Adding
 * a protocol never touches it.
 */
import type { Address } from 'viem'

import type { ProtocolName } from '@/config/protocols-meta'
import { PROTOCOLS_PRESENTATION } from '@/config/protocols-presentation'
import type { ApyEnrichment } from '@/lib/db/repositories/apy'
import type { ProductRow } from '@/lib/db/schema'
import type { CatalogueRow, Collateral } from '@/lib/db/types'
import {
  type PoolIdentity,
  type ProtocolPresentation,
  defaultNetworkSlug,
  defaultPoolIdentity,
  defaultPoolName,
  defaultProductLink,
} from '@/lib/protocols/core/presentation'
import type { BorrowProduct, SupplyProduct, Token } from '@/types'

/** `provider` + `version` — the key of both adapter registries. */
export function adapterId(p: ProductRow): ProtocolName {
  return `${p.provider}_${p.version}` as ProtocolName
}

/**
 * The row's presentation overrides, or `undefined` when its protocol registered
 * none — every field below then falls back to the shared default.
 *
 * `undefined` is also what an UNKNOWN adapter id yields, and that is the
 * intended degradation: a protocol whose fragment is missing renders with
 * default values instead of crashing the table.
 */
function presentation(p: ProductRow): ProtocolPresentation | undefined {
  return PROTOCOLS_PRESENTATION[adapterId(p)]
}

/**
 * The table's `network` field. Default: the canonical chain slug, by chainId.
 * Aave overrides it — its UI presents Lido, EtherFi and Horizon as distinct
 * "networks" though they all sit on Ethereum.
 */
export function networkSlug(p: ProductRow): string {
  return presentation(p)?.networkSlug?.(p) ?? defaultNetworkSlug(p)
}

/**
 * The displayed name. Default: the asset's own name — right wherever one asset
 * means one market per chain (Aave, Compound). Morpho and Blend override it;
 * see their `presentation.ts`.
 */
export function poolName(p: ProductRow): string {
  return presentation(p)?.poolName?.(p) ?? defaultPoolName(p)
}

/**
 * `poolId` and `poolAddress`. Default: the protocol address for both. Morpho
 * overrides it for a market, identified by its marketId while its address is
 * that of the loaned asset.
 */
export function poolIdentity(p: ProductRow): PoolIdentity {
  return presentation(p)?.poolIdentity?.(p) ?? defaultPoolIdentity(p)
}

/**
 * The link to the protocol's app. Default: none. Each protocol that has an app
 * URL owns its template — including how it degrades when the chain is not in
 * the slug registry, since a broken link must never fail a whole page load.
 */
export function productLink(p: ProductRow): string {
  return presentation(p)?.productLink?.(p) ?? defaultProductLink()
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
