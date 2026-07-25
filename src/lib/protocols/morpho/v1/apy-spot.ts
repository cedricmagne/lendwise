import { isFiniteApyBlock } from '@/lib/apy-validation'
import type {
  BorrowMarketState,
  SpotPayload,
  SupplyMarketState,
} from '@/lib/db/types'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import type { FetchOpts } from '@/lib/protocols/core/types'
import type {
  MarketsApyQuery,
  VaultsApyQuery,
} from '@/lib/protocols/morpho/v1/generated/graphql'
import { MARKETS_APY, VAULTS_APY } from '@/lib/protocols/morpho/v1/queries'

import { MORPHO_V1_API_URL, MORPHO_V1_CHAINS } from './config'
import { morphoMarketWhere, morphoVaultWhere } from './listing'
import { buildProductId } from './utils'

/**
 * Raw base units → whole tokens.
 *
 * The pipeline's invariant is that `supply_assets`, `borrow_assets` and
 * `collateral_assets` are ALWAYS whole tokens, so a reader never needs the
 * provider to interpret them. Morpho publishes raw amounts; Aave publishes
 * human ones. Storing both in one column with nothing to distinguish them is
 * what this converts away from — and it also fixed the derived price, which had
 * the raw amount as its denominator and sat at ~1e-15 for every Morpho asset.
 */
function toWholeTokens(
  raw: string | number | null | undefined,
  decimals: number | null | undefined
): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n)) return 0
  // Unknown decimals: return the amount untouched rather than guess a scale.
  // Wrong by a known factor is recoverable; wrong by a guessed one is not.
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) return n
  return n / 10 ** decimals
}

/**
 * Fetch current APY snapshots for Morpho.
 * - Supply snapshots → MetaMorpho vaults (VAULTS_APY)
 * - Borrow snapshots → Morpho Blue markets (MARKETS_APY)
 *
 * Returns SpotPayload documents ready for hourly upsert.
 */
export async function fetchMorphoV1ApySpot(
  opts?: FetchOpts
): Promise<SpotPayload[]> {
  const client = createGraphQLClient(MORPHO_V1_API_URL)

  let chainIds = Object.keys(MORPHO_V1_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  const snapshots: SpotPayload[] = []

  // ─── Phase 1: Supply snapshots from MetaMorpho vaults ─────────────────────

  let skip = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<VaultsApyQuery>(VAULTS_APY, {
        first: 100,
        skip,
        where: morphoVaultWhere(chainIds),
      })
      .toPromise()

    if (error) {
      throw new Error(
        `[cron:morpho_v1] Failed to fetch vault APY: ${error.message}`
      )
    }

    if (!data?.vaults?.items?.length) break

    for (const vault of data.vaults.items) {
      const state = vault.state
      if (!state) continue

      const chainId = vault.asset.chain.id
      const assetSymbol = vault.asset.symbol
      // Canonical slug (CHAIN_SLUG_MAP) — must match the products registry,
      // NOT the human chain label ("Arbitrum One" → "arbitrumone" would orphan
      // the apy_hourly rows from the product row built in products.ts).
      const productId = buildProductId(chainId, vault.address, 'supply')

      // ─── Rewards ────────────────────────────────────────────────────────────
      // Reward APRs kept linear (APR ≈ APY) — reward tokens are separate assets,
      // not auto-compounded. The total uses Morpho's own net delta (below).
      const rewardItems = (state.allRewards ?? [])
        .map((r) => {
          const apr = r.supplyApr ?? 0
          return {
            token: { symbol: r.asset.symbol, address: r.asset.address },
            apr,
            apy: apr,
            source: 'protocol' as const,
            program: null,
          }
        })
        .filter((r) => r.apr > 0)

      // ─── Base / fees ───────────────────────────────────────────────────────
      // netApy / netApyExcludingRewards are Morpho's authoritative aggregates.
      const netApy = state.netApy ?? 0
      const netExclRewards = state.netApyExcludingRewards ?? 0
      const feeRate = state.fee ?? 0
      const grossApy = state.apy ?? 0

      // Total rewards = net − net-excluding-rewards.
      const rewardsTotal = netApy - netExclRewards

      // base = gross supply APY; fee in APY = gross − netExclRewards (the *real*
      // fee, exact vs Morpho — not the approximate base × feeRate). state.apy
      // occasionally spikes (e.g. 4391%) while the net fields stay sane → fall
      // back to the gross implied by netExclRewards + the fee rate. Either way
      // base − fees + rewards === netApy exactly.
      const baseImplied =
        feeRate < 1 ? netExclRewards / (1 - feeRate) : netExclRewards
      const grossGlitched = Math.abs(grossApy - baseImplied) > 0.1
      if (grossGlitched) {
        console.warn(
          `[cron:morpho_v1] Rebuilding glitched supply base ${productId}: gross=${grossApy} implied=${baseImplied}`
        )
      }
      const baseApy = grossGlitched ? baseImplied : grossApy
      const feesApy = baseApy - netExclRewards

      // ─── Market state ────────────────────────────────────────────────────────
      // Amounts are stored in WHOLE TOKEN units, always — a reader must never
      // need the provider to interpret them. Morpho's `totalAssets` is raw base
      // units, so it is divided here; Aave already publishes human units.
      const totalAssets = toWholeTokens(state.totalAssets, vault.asset.decimals)
      const totalAssetsUsd = state.totalAssetsUsd ?? 0
      // Prefer Morpho's own oracle price. Deriving it as totalAssetsUsd /
      // totalAssets is what put every Morpho price at ~1e-15: the denominator
      // was the RAW amount, so the price came out divided by 10^decimals. The
      // derivation is kept as a fallback and is correct now that the
      // denominator is human, but a published price beats an inferred one.
      const assetPriceUsd =
        vault.asset.price?.usd ??
        (totalAssets > 0 ? totalAssetsUsd / totalAssets : 0)

      // Utilization for a MetaMorpho vault = the share of deposits deployed into
      // markets, i.e. NOT withdrawable. Morpho exposes no single field for it, so
      // we derive it from total assets vs withdrawable liquidity — the exact
      // formula the products table uses. Clamped to [0,1] to match the table's
      // displayed value (withdrawable can exceed deposits via shared liquidity).
      const liquidityUsd = vault.liquidity?.usd ?? 0
      const utilizationRate =
        totalAssetsUsd > 0
          ? Math.max(
              0,
              Math.min(1, (totalAssetsUsd - liquidityUsd) / totalAssetsUsd)
            )
          : 0

      const supplyPayload: SpotPayload = {
        productId,
        kind: 'supply',
        protocol: 'morpho',
        chainId,
        asset: assetSymbol,
        apy: {
          base: baseApy,
          rewards: rewardsTotal,
          fees: feesApy,
          net: netApy,
          rewardItems,
        },
        market: {
          supplyAssets: totalAssets,
          supplyAssetsUsd: totalAssetsUsd,
          utilizationRate,
          assetPriceUsd,
        } as SupplyMarketState,
      }

      // Only non-finite components are un-storable. An extreme-but-finite rate is
      // real data and is kept — hiding it is display eligibility's job, not the
      // ingestion pipeline's.
      if (!isFiniteApyBlock(supplyPayload.apy)) {
        const { base, rewards, fees, net } = supplyPayload.apy
        console.warn(
          `[cron:morpho_v1] Dropping non-finite supply APY ${productId}: base=${base} rewards=${rewards} fees=${fees} net=${net}`
        )
        continue
      }

      snapshots.push(supplyPayload)
    }

    const pageInfo = data.vaults.pageInfo
    if (pageInfo && pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  // ─── Phase 2: Borrow snapshots from Morpho Blue markets ───────────────────

  skip = 0
  hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<MarketsApyQuery>(MARKETS_APY, {
        first: 100,
        skip,
        where: morphoMarketWhere(chainIds),
      })
      .toPromise()

    if (error) {
      throw new Error(
        `[cron:morpho_v1] Failed to fetch market APY: ${error.message}`
      )
    }

    if (!data?.markets?.items?.length) break

    for (const market of data.markets.items) {
      const state = market.state
      if (!state) continue

      const chainId = market.loanAsset.chain.id
      const loanSymbol = market.loanAsset.symbol

      // ─── Rewards ────────────────────────────────────────────────────────────

      // Reward APRs kept linear (APR ≈ APY): reward tokens are separate assets,
      // not auto-compounded into the position. The reward *total* is taken from
      // Morpho's own net below (netBorrow = borrow − reward), not summed here —
      // continuous compounding (e^APR) massively over-inflated it (822% vs 222%).
      const borrowRewardItems = state.rewards
        .filter(
          (r): r is typeof r & { borrowApr: number } =>
            r.borrowApr != null && r.borrowApr > 0
        )
        .map((r) => ({
          token: { symbol: r.asset.symbol, address: r.asset.address },
          apr: r.borrowApr,
          apy: r.borrowApr,
          source: 'protocol' as const,
          program: null,
        }))

      // ─── Market state ────────────────────────────────────────────────────────

      // Same whole-token rule as the vault side: `state.*Assets` are raw base
      // units of the LOAN asset, so both are divided by its decimals.
      const loanDecimals = market.loanAsset.decimals
      const supplyAssetsUsd = state.supplyAssetsUsd ?? 0
      const supplyAssets = toWholeTokens(state.supplyAssets, loanDecimals)
      const borrowAssetsUsd = state.borrowAssetsUsd ?? 0
      const borrowAssets = toWholeTokens(state.borrowAssets, loanDecimals)
      const utilizationRate = state.utilization ?? 0
      const assetPriceUsd =
        supplyAssets > 0 ? supplyAssetsUsd / supplyAssets : 0

      const borrowApy = state.borrowApy ?? 0
      const netBorrowApy = state.netBorrowApy ?? borrowApy

      // ─── Borrow payload ──────────────────────────────────────────────────────
      const borrowProductId = buildProductId(chainId, market.marketId, 'borrow')
      const borrowPayload: SpotPayload = {
        productId: borrowProductId,
        kind: 'borrow',
        protocol: 'morpho',
        chainId,
        asset: loanSymbol,
        apy: {
          base: borrowApy,
          // Reward total derived from Morpho's own net (netBorrow = borrow −
          // reward) so base − rewards === net exactly, matching Morpho's UI.
          rewards: Math.max(0, borrowApy - netBorrowApy),
          // The market fee is taken from supplier interest, not a borrower cost.
          fees: 0,
          net: netBorrowApy,
          rewardItems: borrowRewardItems,
        },
        market: {
          supplyAssets,
          supplyAssetsUsd,
          borrowAssets,
          borrowAssetsUsd,
          utilizationRate,
          assetPriceUsd,
          collateralAssetsUsd: null, // not exposed in current query
          priceCollateralInLoanAsset: null, // TODO: derive from collateral state
        } as BorrowMarketState,
      }

      if (!isFiniteApyBlock(borrowPayload.apy)) {
        const { base, rewards, fees, net } = borrowPayload.apy
        console.warn(
          `[cron:morpho_v1] Dropping non-finite borrow APY ${borrowProductId}: base=${base} rewards=${rewards} fees=${fees} net=${net}`
        )
        continue
      }

      snapshots.push(borrowPayload)
    }

    const pageInfo = data.markets.pageInfo
    if (pageInfo && pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  const supplyCount = snapshots.filter((s) => s.kind === 'supply').length
  const borrowCount = snapshots.filter((s) => s.kind === 'borrow').length
  console.log(
    `[cron:morpho_v1] Fetched ${snapshots.length} snapshots (${supplyCount} vaults, ${borrowCount} markets)`
  )
  return snapshots
}
