import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import {
  type AaveMarketDayState,
  fetchAaveMarketHistory,
  marketDayKey,
} from '@/lib/protocols/aave/v3/market-history'
import {
  APY_HISTORY,
  MARKETS_WITH_TOKENS,
} from '@/lib/protocols/aave/v3/queries'
import { buildProductNetworkSlug } from '@/lib/protocols/aave/v3/utils'
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
  productIds?: string[]
  targets?: HistoryTarget[]
  /** AAVE API window — e.g. 'LAST_DAY' (hourly points) or 'LAST_YEAR' (daily). Default: 'LAST_YEAR'. */
  window?: string
  onProgress?: (msg: string) => void
}): Promise<HistoryResult> {
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

  // A caller that names its products pays for those reserves only. One reserve
  // answers BOTH sides in a single query, so it is fetched when EITHER side is
  // wanted — and only once.
  const wanted = requestedProducts(opts ?? {})?.ids ?? null
  const sidesOf = (r: (typeof reserves)[number]) => {
    const network = buildProductNetworkSlug(r.marketChainName)
    const base = `aave:v3:${network}:reserve:${r.tokenAddress.toLowerCase()}`
    return [`${base}:supply`, `${base}:borrow`]
  }
  const targets = wanted
    ? reserves.filter((r) => sidesOf(r).some((id) => wanted.has(id)))
    : reserves

  log(
    `[history:aave] Found ${reserves.length} reserves across ${marketsData.markets.length} markets, fetching ${targets.length} (parallel batches)`
  )

  // Step 2: Fetch history for each reserve (batched)
  const reservePoints = await processBatches(targets, async (reserve) => {
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

      // Build date → { supplyApy, borrowApy } map. A side is `null` when the
      // API simply has no entry for that date on that side — the two history
      // queries can disagree on which dates they cover, and a missing date is
      // not a real 0% rate. Emitting a fabricated 0% point here would be the
      // same zero-vs-null lie as the market-state bug above, just on the rate.
      const dateMap = new Map<
        string,
        { supplyApy: number | null; borrowApy: number | null }
      >()

      for (const entry of data?.supplyAPYHistory ?? []) {
        const existing = dateMap.get(entry.date) ?? {
          supplyApy: null,
          borrowApy: null,
        }
        existing.supplyApy = entry.avgRate.value
        dateMap.set(entry.date, existing)
      }

      for (const entry of data?.borrowAPYHistory ?? []) {
        const existing = dateMap.get(entry.date) ?? {
          supplyApy: null,
          borrowApy: null,
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

        // Supply point — only when the API actually reported a supply rate
        // for this date; otherwise this date is a gap for the supply side.
        if (rates.supplyApy !== null) {
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
        }

        // Borrow point — only when the API actually reported a borrow rate.
        if (rates.borrowApy !== null) {
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

  const collected: HistoryDataPoint[] = []
  for (const pts of reservePoints) {
    for (const pt of pts) collected.push(pt)
  }

  // One reserve answers both sides, so fetching it for its supply side also
  // yields a borrow point nobody asked for. Drop it: a targeted caller writes
  // what it receives, and an unrequested row is one it never reconciled.
  const allPoints = wanted
    ? collected.filter((p) => wanted.has(p.productId))
    : collected

  // A requested product that no market carries is a reportable miss. Note the
  // asymmetry with "fetched but empty": a reserve can legitimately have no
  // borrow-side history, so only products whose RESERVE was never found are
  // failures here — the caller learns the difference from the reason string.
  const failures: HistoryFailure[] = []
  if (wanted) {
    const reachable = new Set(targets.flatMap(sidesOf))
    const returned = new Set(allPoints.map((p) => p.productId))
    for (const productId of wanted) {
      if (returned.has(productId)) continue
      failures.push({
        productId,
        reason: reachable.has(productId)
          ? 'reserve fetched but returned no history for this side'
          : 'no Aave market carries this reserve',
      })
    }
  }

  log(
    `[history:aave] Total: ${allPoints.length} data points${failures.length > 0 ? `, ${failures.length} unanswered` : ''}`
  )
  return { points: allPoints, failures }
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
 * Merge day-closing market state from the subgraphs into rate-only points.
 *
 * Aave is the one adapter whose history needs two upstreams: the unified API
 * has the rates and nothing else, the per-pool subgraphs have the state and no
 * rates. The contract says a caller must never see that split, so the join
 * happens here, on (productId, UTC day).
 *
 * A point with no matching state keeps its NULLs — unknown, not zero. Borrow
 * points additionally get the borrow-side columns; supply points never do.
 */
export function mergeMarketStates(
  points: HistoryDataPoint[],
  states: Map<string, AaveMarketDayState>
): HistoryDataPoint[] {
  return points.map((p) => {
    const state = states.get(marketDayKey(p.productId, p.timestamp))
    if (!state) return p

    const price = state.priceUsd
    const supplyState: SupplyMarketState = {
      supplyAssets: state.supplyAssets,
      supplyAssetsUsd: price == null ? null : state.supplyAssets * price,
      utilizationRate: state.utilizationRate,
      assetPriceUsd: price,
    }
    if (p.kind === 'supply') return { ...p, market: supplyState }

    const borrowState: BorrowMarketState = {
      ...supplyState,
      borrowAssets: state.borrowAssets,
      borrowAssetsUsd: price == null ? null : state.borrowAssets * price,
      // AAVE is multi-collateral — no single collateral value or price ratio.
      collateralAssetsUsd: null,
      priceCollateralInLoanAsset: null,
    }
    return { ...p, market: borrowState }
  })
}

/**
 * YieldAdapter.getApyHistory implementation for Aave v3.
 *
 * Maps the contract's (startTimestamp, endTimestamp) range onto an Aave API
 * window, delegates to `fetchAaveHistory`, trims the (now-anchored) points back
 * down to the requested range, then merges in the subgraphs' market state.
 *
 * The merge runs only for `interval: 'DAY'` and only when `includeMarket` is
 * not false: subgraph states are day-closing values by construction, and the
 * fan-out is ~1k requests — the hourly heal job must never pay for it.
 * A total market-source failure degrades to rates-with-NULLs; it never costs
 * the caller the rates it asked for.
 */
export async function getAaveApyHistory(
  params: HistoryParams
): Promise<HistoryResult> {
  const window = aaveWindowForRange(
    params.startTimestamp,
    Math.floor(Date.now() / 1000)
  )
  const { points, failures } = await fetchAaveHistory({
    window,
    chainIds: params.chainIds,
    productIds: params.productIds,
    targets: params.targets,
    onProgress: params.onProgress,
  })
  // The API windows are anchored to now — trim to the requested range.
  const inRange = points.filter((p) => {
    const t = p.timestamp.getTime() / 1000
    return t >= params.startTimestamp && t <= params.endTimestamp
  })

  const wantsMarket =
    params.interval === 'DAY' &&
    params.includeMarket !== false &&
    // Every pool with a published subgraph is on Ethereum (chainId 1).
    (params.chainIds === undefined || params.chainIds.includes(1))
  if (!wantsMarket) return { points: inRange, failures }

  const log = params.onProgress ?? console.log
  try {
    const states = await fetchAaveMarketHistory({
      from: new Date(params.startTimestamp * 1000),
      to: new Date(params.endTimestamp * 1000),
      onProgress: params.onProgress,
    })
    return { points: mergeMarketStates(inRange, states), failures }
  } catch (err) {
    log(
      `[history:aave] market state unavailable, returning rates only: ${err instanceof Error ? err.message : String(err)}`
    )
    return { points: inRange, failures }
  }
}

// Re-export for backwards compatibility
export { fetchAaveHistory as syncAaveHistory }
