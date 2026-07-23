import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import {
  APY_HISTORY,
  MARKETS_WITH_TOKENS,
} from '@/lib/protocols/aave/v3/queries'
import { buildProductNetworkSlug } from '@/lib/protocols/aave/v3/utils'
import {
  createGraphQLClient,
  processBatches,
} from '@/lib/protocols/core/toolkit'
import type {
  HistoryDataPoint,
  HistoryParams,
} from '@/lib/protocols/core/types'

import { AAVE_V3_API_URL, AAVE_V3_CHAINS } from './config'

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketsWithTokensQuery = {
  markets: {
    address: string
    name: string
    chain: { name: string; chainId: number }
    reserves: {
      underlyingToken: { address: string; symbol: string }
    }[]
  }[]
}

type ApyHistoryQuery = {
  supplyAPYHistory: { date: string; avgRate: { value: number } }[]
  borrowAPYHistory: { date: string; avgRate: { value: number } }[]
}

// Re-export the contract type from its new home, so callers still importing
// `HistoryDataPoint` from this module keep compiling until Task 8.
export type { HistoryDataPoint }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Market state for a backfilled Aave history point: UNKNOWN, not empty.
 *
 * Aave's offchain APY_HISTORY query returns rates only — no TVL/utilization
 * timeseries — so a backfilled point genuinely has no market state. It used to
 * record zeros, and a zero is not a blank, it's a claim: "this reserve holds
 * nothing." Those zeros were add-only (`ON CONFLICT DO NOTHING`), so once
 * written they never self-correct, and the chart rendered a full year of flat
 * $0 TVL / 0% utilization for every reserve. NULL says what is true: we don't
 * know. See the identical Morpho lesson on unknownBorrowMarket below.
 */
function unknownSupplyMarket(): SupplyMarketState {
  return {
    supplyAssets: null,
    supplyAssetsUsd: null,
    utilizationRate: null,
    assetPriceUsd: null,
  }
}

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

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch historical AAVE v3 APY data.
 *
 * Uses the AAVE offchain GraphQL API which supports up to LAST_YEAR window.
 * Returns daily data points with supply and borrow APY per reserve.
 */
export async function fetchAaveHistory(opts?: {
  chainIds?: number[]
  /** AAVE API window — e.g. 'LAST_DAY' (hourly points) or 'LAST_YEAR' (daily). Default: 'LAST_YEAR'. */
  window?: string
  onProgress?: (msg: string) => void
}): Promise<HistoryDataPoint[]> {
  const log = opts?.onProgress ?? console.log
  const client = createGraphQLClient(AAVE_V3_API_URL)

  let chainIds = Object.keys(AAVE_V3_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  // Step 1: List all markets and their reserves
  const { data: marketsData, error: marketsError } = await client
    .query<MarketsWithTokensQuery>(MARKETS_WITH_TOKENS, {
      request: { chainIds },
    })
    .toPromise()

  if (marketsError || !marketsData?.markets) {
    throw new Error(
      `[history:aave] Failed to list markets: ${marketsError?.message ?? 'No data'}`
    )
  }

  type ReserveInfo = {
    marketAddress: string
    chainId: number
    chainName: string
    marketChainName: string // Aave deployment name, e.g. 'AaveV3EthereumLido'
    tokenAddress: string
    tokenSymbol: string
  }

  const reserves: ReserveInfo[] = []
  for (const market of marketsData.markets) {
    for (const reserve of market.reserves) {
      reserves.push({
        marketAddress: market.address,
        chainId: market.chain.chainId,
        chainName: market.chain.name.toLowerCase(),
        marketChainName: market.name,
        tokenAddress: reserve.underlyingToken.address,
        tokenSymbol: reserve.underlyingToken.symbol,
      })
    }
  }

  log(
    `[history:aave] Found ${reserves.length} reserves across ${marketsData.markets.length} markets (fetching in parallel batches)`
  )

  // Step 2: Fetch history for each reserve (batched)
  const reservePoints = await processBatches(reserves, async (reserve) => {
    try {
      const historyRequest = {
        chainId: reserve.chainId,
        market: reserve.marketAddress,
        underlyingToken: reserve.tokenAddress,
        window: opts?.window ?? 'LAST_YEAR',
      }

      const { data, error } = await client
        .query<ApyHistoryQuery>(APY_HISTORY, {
          supplyRequest: historyRequest,
          borrowRequest: historyRequest,
        })
        .toPromise()

      if (error) {
        log(
          `[history:aave] ${reserve.tokenSymbol}@${reserve.chainName}: ${error.message}`
        )
        return null
      }

      // Build date → { supplyApy, borrowApy } map
      const dateMap = new Map<
        string,
        { supplyApy: number; borrowApy: number }
      >()

      for (const entry of data?.supplyAPYHistory ?? []) {
        const existing = dateMap.get(entry.date) ?? {
          supplyApy: 0,
          borrowApy: 0,
        }
        existing.supplyApy = entry.avgRate.value
        dateMap.set(entry.date, existing)
      }

      for (const entry of data?.borrowAPYHistory ?? []) {
        const existing = dateMap.get(entry.date) ?? {
          supplyApy: 0,
          borrowApy: 0,
        }
        existing.borrowApy = entry.avgRate.value
        dateMap.set(entry.date, existing)
      }

      const network = buildProductNetworkSlug(reserve.marketChainName)
      const supplyProductId = `aave:v3:${network}:reserve:${reserve.tokenAddress.toLowerCase()}:supply`
      const borrowProductId = `aave:v3:${network}:reserve:${reserve.tokenAddress.toLowerCase()}:borrow`

      const points: HistoryDataPoint[] = []
      for (const [date, rates] of dateMap) {
        const timestamp = new Date(date)

        // Supply point
        points.push({
          timestamp,
          productId: supplyProductId,
          kind: 'supply',
          apy: {
            base: rates.supplyApy,
            rewards: 0,
            fees: 0,
            net: rates.supplyApy,
            rewardItems: [],
          },
          market: unknownSupplyMarket(),
        })

        // Borrow point
        points.push({
          timestamp,
          productId: borrowProductId,
          kind: 'borrow',
          apy: {
            base: rates.borrowApy,
            rewards: 0,
            fees: 0,
            net: rates.borrowApy,
            rewardItems: [],
          },
          market: unknownBorrowMarket(),
        })
      }

      log(
        `[history:aave] ${reserve.tokenSymbol}@${reserve.chainName}: ${dateMap.size} days`
      )
      return points
    } catch (err) {
      log(
        `[history:aave] ${reserve.tokenSymbol}@${reserve.chainName}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  })

  const allPoints: HistoryDataPoint[] = []
  for (const pts of reservePoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  log(`[history:aave] Total: ${allPoints.length} data points`)
  return allPoints
}

// ─── Contract mapping ─────────────────────────────────────────────────────────

/**
 * Pick the smallest Aave API window that still covers the requested lookback.
 *
 * The Aave GraphQL history endpoint only accepts fixed windows anchored to now
 * (LAST_DAY / LAST_WEEK / LAST_YEAR). Map a caller's `startTimestamp` onto the
 * tightest one so we fetch no more than we need.
 */
export function aaveWindowForRange(
  startTimestamp: number,
  nowTimestamp: number
): 'LAST_DAY' | 'LAST_WEEK' | 'LAST_YEAR' {
  const lookbackHours = (nowTimestamp - startTimestamp) / 3600
  if (lookbackHours <= 24) return 'LAST_DAY'
  if (lookbackHours <= 7 * 24) return 'LAST_WEEK'
  return 'LAST_YEAR'
}

/**
 * YieldAdapter.getApyHistory implementation for Aave v3.
 *
 * Maps the contract's (startTimestamp, endTimestamp) range onto an Aave API
 * window, delegates to `fetchAaveHistory`, then trims the (now-anchored) points
 * back down to the requested range.
 */
export async function getAaveApyHistory(
  params: HistoryParams
): Promise<HistoryDataPoint[]> {
  const window = aaveWindowForRange(
    params.startTimestamp,
    Math.floor(Date.now() / 1000)
  )
  const points = await fetchAaveHistory({
    window,
    chainIds: params.chainIds,
    onProgress: params.onProgress,
  })
  // The API windows are anchored to now — trim to the requested range.
  return points.filter((p) => {
    const t = p.timestamp.getTime() / 1000
    return t >= params.startTimestamp && t <= params.endTimestamp
  })
}

// Re-export for backwards compatibility
export { fetchAaveHistory as syncAaveHistory }
