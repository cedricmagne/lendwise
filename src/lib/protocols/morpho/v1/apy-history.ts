import { isFiniteApyBlock } from '@/lib/apy-validation'
import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import { requestedProducts } from '@/lib/protocols/core/history-result'
import {
  createGraphQLClient,
  processBatches,
} from '@/lib/protocols/core/toolkit'
import type {
  HistoryDataPoint,
  HistoryFailure,
  HistoryParams,
  HistoryResult,
  HistoryTarget,
} from '@/lib/protocols/core/types'
import {
  MORPHO_V1_API_URL,
  MORPHO_V1_CHAINS,
} from '@/lib/protocols/morpho/v1/config'
import {
  morphoMarketWhere,
  morphoVaultWhere,
} from '@/lib/protocols/morpho/v1/listing'
import {
  MARKETS_APY,
  MARKET_BORROW_HISTORY,
  VAULTS_APY,
  VAULT_SUPPLY_HISTORY,
} from '@/lib/protocols/morpho/v1/queries'
import { buildProductId } from '@/lib/protocols/morpho/v1/utils'

// ─── Response types ───────────────────────────────────────────────────────────

type FloatDataPoint = { x: number; y: number | null }

type VaultHistoryQuery = {
  vaultByAddress: {
    address: string
    asset: {
      symbol: string
      chain: { id: number; network: string }
    }
    historicalState: {
      apy: FloatDataPoint[]
      netApy: FloatDataPoint[]
      fee: FloatDataPoint[]
      totalAssetsUsd: FloatDataPoint[]
      totalAssets: FloatDataPoint[]
    }
  } | null
}

type MarketBorrowHistoryQuery = {
  marketById: {
    historicalState: {
      borrowApy: FloatDataPoint[]
      netBorrowApy: FloatDataPoint[]
      dailyBorrowApy: FloatDataPoint[]
    }
  } | null
}

type VaultsApyItem = {
  address: string
  asset: {
    symbol: string
    chain: { id: number; network: string }
  }
}

type VaultsListQuery = {
  vaults: {
    items: VaultsApyItem[]
    pageInfo: { countTotal: number; count: number; limit: number; skip: number }
  }
}

type MarketsListItem = {
  id: string
  marketId: string
  loanAsset: {
    symbol: string
    chain: { id: number; network: string }
  }
  collateralAsset: { symbol: string } | null
}

type MarketsListQuery = {
  markets: {
    items: MarketsListItem[]
    pageInfo: { countTotal: number; count: number; limit: number; skip: number }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Market state for a healed borrow hour: UNKNOWN, not empty.
 *
 * Morpho's market-history query returns rates but no liquidity, so a healed borrow
 * row genuinely has no market state. It used to record zeros — and a zero is not a
 * blank, it is a CLAIM: "this market holds nothing". 1,595 rows asserted exactly
 * that about markets holding tens of millions, and the display policy, reading
 * `supply_assets_usd = 0`, dutifully hid two $27M markets as `low_liquidity`.
 *
 * NULL says what is true: we do not know. Every consumer already handles it —
 * `minTvlUsd` skips the row and ORDER BY pushes it last. There is no dedicated
 * healed-row exclusion anywhere in the system: a healed row with a NULL TVL is
 * dropped by the same "unknown TVL fails every operator" rule that applies to
 * any other row with unknown TVL, on both evaluators. A refetch-healed row
 * carries the protocol's true rate but a blank market state, and a
 * nearest-neighbour-healed one copies its neighbour's TVL verbatim. Neither
 * observed the market it describes.
 *
 * The real fix is for MARKET_BORROW_HISTORY to fetch the liquidity timeseries
 * alongside the rates; until then, an honest blank beats a confident zero.
 */
function unknownBorrowMarket(): BorrowMarketState {
  return {
    supplyAssets: null,
    supplyAssetsUsd: null,
    borrowAssets: null,
    borrowAssetsUsd: null,
    utilizationRate: null,
    assetPriceUsd: null,
    collateralAssetsUsd: null,
    priceCollateralInLoanAsset: null,
  }
}

/**
 * Requested products the listing did not return, rebuilt from their catalogue
 * row so they can be fetched by their own identifier.
 *
 * This is what reaches a market Morpho has DELISTED. Dropping the ingestion
 * floors is not enough there — `listed: true` excludes it from every
 * enumeration — but `marketById` / `vaultByAddress` still answer. The key
 * (`meta.id`, falling back to `meta.address`) is what this adapter wrote at
 * getProducts time, so reading it back is symmetric, not a leak.
 *
 * A target whose row carries no usable key is left out; it will surface as a
 * failure with the rest.
 */
function unlistedTargets(
  wanted: Set<string> | null,
  targetsById: Map<string, HistoryTarget>,
  alreadyCovered: Set<string>,
  kind: 'supply' | 'borrow'
): { address: string; chainId: number; network: string; symbol: string }[] {
  if (!wanted || targetsById.size === 0) return []

  const extra: {
    address: string
    chainId: number
    network: string
    symbol: string
  }[] = []

  for (const productId of wanted) {
    if (alreadyCovered.has(productId)) continue
    const target = targetsById.get(productId)
    if (!target || target.kind !== kind) continue

    const key = target.meta.id ?? target.meta.address
    if (typeof key !== 'string' || key.length === 0) continue

    extra.push({
      address: key,
      chainId: target.chainId,
      network: String(target.chainId),
      symbol: 'delisted',
    })
  }
  return extra
}

/**
 * Build a map of timestamp → value from a FloatDataPoint timeseries.
 * x is a Unix timestamp in seconds.
 */
function toMap(series: FloatDataPoint[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const pt of series) {
    if (pt.y != null) map.set(pt.x, pt.y)
  }
  return map
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch historical Morpho APY data.
 *
 * - Supply (MetaMorpho vaults): uses vaultByAddress → historicalState timeseries
 * - Borrow (Morpho Blue markets): uses market → historicalState timeseries
 *
 * The Morpho API supports custom start/end timestamps with configurable interval.
 */
export async function fetchMorphoHistory(opts?: {
  chainIds?: number[]
  productIds?: string[]
  targets?: HistoryTarget[]
  startTimestamp?: number
  endTimestamp?: number
  interval?: string
  onProgress?: (msg: string) => void
}): Promise<HistoryResult> {
  const log = opts?.onProgress ?? console.log
  const client = createGraphQLClient(MORPHO_V1_API_URL, undefined, 60_000)

  let chainIds = Object.keys(MORPHO_V1_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  // A caller that names its products gets a targeted run: the listing drops its
  // ingestion floors (so a market that has since fallen under them is still
  // reachable) and the fan-out covers the intersection only. See ListingOpts.
  const requested = requestedProducts(opts ?? {})
  const wanted = requested?.ids ?? null
  const targetsById = requested?.byId ?? new Map()
  const listingOpts = { unfloored: wanted !== null }
  const answered = new Set<string>()
  const failures: HistoryFailure[] = []

  const timeseriesOptions: Record<string, unknown> = {}
  if (opts?.startTimestamp)
    timeseriesOptions.startTimestamp = opts.startTimestamp
  if (opts?.endTimestamp) timeseriesOptions.endTimestamp = opts.endTimestamp
  timeseriesOptions.interval = opts?.interval ?? 'DAY'

  const allPoints: HistoryDataPoint[] = []

  // ─── Phase 1: Supply (MetaMorpho vaults) ──────────────────────────────────

  // First, list all vaults to get their addresses
  const vaultAddresses: {
    address: string
    chainId: number
    network: string
    symbol: string
  }[] = []
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<VaultsListQuery>(VAULTS_APY, {
        first: 100,
        skip,
        where: morphoVaultWhere(chainIds, listingOpts),
      })
      .toPromise()

    if (error) {
      log(`[history:morpho] Failed to list vaults: ${error.message}`)
      break
    }

    if (!data?.vaults?.items?.length) break

    for (const vault of data.vaults.items) {
      vaultAddresses.push({
        address: vault.address,
        chainId: vault.asset.chain.id,
        network: vault.asset.chain.network.toLowerCase().replaceAll(' ', ''),
        symbol: vault.asset.symbol,
      })
    }

    const pageInfo = data.vaults.pageInfo
    if (pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  const targetVaults = wanted
    ? vaultAddresses.filter((v) =>
        wanted.has(buildProductId(v.chainId, v.address, 'supply'))
      )
    : vaultAddresses

  // Vaults the catalogue still knows but Morpho has stopped LISTING: the
  // enumeration above cannot see them, yet `vaultByAddress` answers for them.
  // The address comes from the products row this adapter itself wrote.
  for (const v of unlistedTargets(
    wanted,
    targetsById,
    new Set(
      targetVaults.map((v) => buildProductId(v.chainId, v.address, 'supply'))
    ),
    'supply'
  )) {
    targetVaults.push(v)
  }

  for (const v of targetVaults) {
    answered.add(buildProductId(v.chainId, v.address, 'supply'))
  }

  log(
    `[history:morpho] Found ${vaultAddresses.length} vaults, fetching ${targetVaults.length} (parallel batches)`
  )

  // Fetch history for each vault (batched)
  const vaultPoints = await processBatches(targetVaults, async (vault) => {
    try {
      const { data, error } = await client
        .query<VaultHistoryQuery>(VAULT_SUPPLY_HISTORY, {
          address: vault.address,
          // REQUIRED: vault addresses are not unique across chains. Without
          // chainId the API defaults to Ethereum and returns "No results" for
          // every other chain's vault — silently zeroing all non-ETH vault
          // history (heal refetch + backfill alike).
          chainId: vault.chainId,
          options: timeseriesOptions,
        })
        .toPromise()

      if (error || !data?.vaultByAddress) {
        log(
          `[history:morpho] vault ${vault.symbol}@${vault.network}: ${error?.message ?? 'no data'}`
        )
        return null
      }

      const hist = data.vaultByAddress.historicalState
      const apyMap = toMap(hist.apy)
      const netApyMap = toMap(hist.netApy)
      const feeMap = toMap(hist.fee)
      const totalAssetsUsdMap = toMap(hist.totalAssetsUsd)

      const productId = buildProductId(vault.chainId, vault.address, 'supply')

      // Use netApy timestamps as reference (most complete)
      const timestamps = new Set([...apyMap.keys(), ...netApyMap.keys()])
      const points: HistoryDataPoint[] = []

      for (const ts of timestamps) {
        const baseApy = apyMap.get(ts) ?? 0
        const netApy = netApyMap.get(ts) ?? 0
        const fee = feeMap.get(ts) ?? 0
        const rewards = netApy - baseApy * (1 - fee)
        const totalAssetsUsd = totalAssetsUsdMap.get(ts) ?? 0

        const apy = {
          base: baseApy,
          rewards: Math.max(0, rewards),
          // fee is the 0–1 fee rate → store fee-APY (= base × fee rate).
          fees: baseApy * fee,
          net: netApy,
          rewardItems: [],
        }
        // Same finite-only contract as the spot job. Healed rows land in
        // apy_hourly exactly like collected ones, so an unguarded heal was the
        // one path by which a NaN could reach the table.
        if (!isFiniteApyBlock(apy)) continue

        points.push({
          timestamp: new Date(ts * 1000),
          productId,
          kind: 'supply',
          apy,
          market: {
            // The vault history API gives the USD total and nothing else: no
            // token amount, no price, no liquidity timeseries. All three are
            // therefore null ("unknown"), never a 0 — a 0 is a claim, and
            // backfilled rows are add-only, so a false one never self-corrects.
            // (supplyAssets and assetPriceUsd used to be 0 here while the
            // comment below only spared utilizationRate.)
            supplyAssets: null,
            supplyAssetsUsd: totalAssetsUsd,
            utilizationRate: null,
            assetPriceUsd: null,
          } as SupplyMarketState,
        })
      }

      log(
        `[history:morpho] vault ${vault.symbol}@${vault.network}: ${timestamps.size} points`
      )
      return points
    } catch (err) {
      log(
        `[history:morpho] vault ${vault.symbol}@${vault.network}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  })
  for (const pts of vaultPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  // ─── Phase 2: Borrow (Morpho Blue markets) ───────────────────────────────

  const marketKeys: {
    id: string
    marketId: string
    chainId: number
    network: string
    loanSymbol: string
  }[] = []
  skip = 0
  hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<MarketsListQuery>(MARKETS_APY, {
        first: 100,
        skip,
        where: morphoMarketWhere(chainIds, listingOpts),
      })
      .toPromise()

    if (error) {
      log(`[history:morpho] Failed to list markets: ${error.message}`)
      break
    }

    if (!data?.markets?.items?.length) break

    for (const market of data.markets.items) {
      marketKeys.push({
        id: market.id,
        marketId: market.marketId,
        chainId: market.loanAsset.chain.id,
        network: market.loanAsset.chain.network
          .toLowerCase()
          .replaceAll(' ', ''),
        loanSymbol: market.loanAsset.symbol,
      })
    }

    const pageInfo = data.markets.pageInfo
    if (pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  const targetMarkets = wanted
    ? marketKeys.filter((m) =>
        wanted.has(buildProductId(m.chainId, m.marketId, 'borrow'))
      )
    : marketKeys

  // Same rescue as the vault side: a DELISTED market is invisible to the
  // enumeration but `marketById` still returns its history.
  for (const m of unlistedTargets(
    wanted,
    targetsById,
    new Set(
      targetMarkets.map((m) => buildProductId(m.chainId, m.marketId, 'borrow'))
    ),
    'borrow'
  )) {
    targetMarkets.push({
      id: m.address,
      marketId: m.address,
      chainId: m.chainId,
      network: m.network,
      loanSymbol: m.symbol,
    })
  }

  for (const m of targetMarkets) {
    answered.add(buildProductId(m.chainId, m.marketId, 'borrow'))
  }

  log(
    `[history:morpho] Found ${marketKeys.length} borrow markets, fetching ${targetMarkets.length} (parallel batches)`
  )

  const marketPoints = await processBatches(targetMarkets, async (market) => {
    try {
      const { data, error } = await client
        .query<MarketBorrowHistoryQuery>(MARKET_BORROW_HISTORY, {
          marketId: market.marketId,
          chainId: market.chainId,
          options: timeseriesOptions,
        })
        .toPromise()

      if (error || !data?.marketById) {
        log(
          `[history:morpho] market ${market.loanSymbol}@${market.network}: ${error?.message ?? 'no data'}`
        )
        return null
      }

      const hist = data.marketById.historicalState
      const borrowApyMap = toMap(hist.borrowApy)
      const netBorrowApyMap = toMap(hist.netBorrowApy)

      const productId = buildProductId(
        market.chainId,
        market.marketId,
        'borrow'
      )
      const timestamps = new Set([
        ...borrowApyMap.keys(),
        ...netBorrowApyMap.keys(),
      ])

      const points: HistoryDataPoint[] = []
      for (const ts of timestamps) {
        const borrowApy = borrowApyMap.get(ts) ?? 0
        const netBorrowApy = netBorrowApyMap.get(ts) ?? borrowApy

        const apy = {
          base: borrowApy,
          // Reward total derived from Morpho's own net (netBorrow = borrow −
          // reward) so base − rewards === net exactly, matching the spot job.
          rewards: Math.max(0, borrowApy - netBorrowApy),
          // The market fee is taken from supplier interest, not a borrower cost.
          fees: 0,
          net: netBorrowApy,
          rewardItems: [],
        }
        if (!isFiniteApyBlock(apy)) continue

        points.push({
          timestamp: new Date(ts * 1000),
          productId,
          kind: 'borrow',
          apy,
          market: unknownBorrowMarket(),
        })
      }

      log(
        `[history:morpho] market ${market.loanSymbol}@${market.network}: ${timestamps.size} points`
      )
      return points
    } catch (err) {
      log(
        `[history:morpho] market ${market.loanSymbol}@${market.network}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  })
  for (const pts of marketPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  // A requested product the catalogue never offered is a reportable miss, not a
  // silent absence: the caller can tell "the protocol has no history for this"
  // from "we quietly fetched something else".
  if (wanted) {
    const returned = new Set(allPoints.map((p) => p.productId))
    for (const productId of wanted) {
      if (returned.has(productId)) continue
      failures.push({
        productId,
        reason: answered.has(productId)
          ? 'listed but returned no history points'
          : 'not in the Morpho catalogue',
      })
    }
  }

  log(
    `[history:morpho] Total: ${allPoints.length} data points (${allPoints.filter((p) => p.kind === 'supply').length} supply, ${allPoints.filter((p) => p.kind === 'borrow').length} borrow)${failures.length > 0 ? `, ${failures.length} unanswered` : ''}`
  )
  return { points: allPoints, failures }
}

// ─── Contract mapping ─────────────────────────────────────────────────────────

/**
 * YieldAdapter.getApyHistory implementation for Morpho v1.
 *
 * The Morpho API already accepts a custom (startTimestamp, endTimestamp, interval)
 * window, so this is a thin passthrough onto `fetchMorphoHistory` — no window
 * remapping or post-fetch trimming is needed the way Aave's does.
 */
export async function getMorphoApyHistory(
  params: HistoryParams
): Promise<HistoryResult> {
  return fetchMorphoHistory({
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    interval: params.interval,
    chainIds: params.chainIds,
    productIds: params.productIds,
    targets: params.targets,
    onProgress: params.onProgress,
  })
}
