import type { Address } from 'viem'

import type {
  ApyBreakdown,
  BorrowMarketState,
  BorrowProduct,
  SpotPayload,
  SupplyMarketState,
  SupplyProduct,
} from '@/lib/db/types'
import type {
  BorrowPosition,
  MarketRate,
  SupplyPosition,
  TimeframeLabel,
  BorrowProduct as UiBorrowProduct,
  SupplyProduct as UiSupplyProduct,
} from '@/types'

/** Minimal chain config. Adapter-specific extras allowed. */
export interface AdapterChain {
  /** Canonical productId slug — must match CHAIN_SLUG_MAP. */
  slug: string
  /** Adapter-owned extras (subgraphUrl, marketName, …). */
  [key: string]: unknown
}

export interface FetchOpts {
  /** Filter by canonical chain_id. Replaces the old name-matching chainFilter. */
  chainIds?: number[]
  /**
   * Pool ids to enumerate, pre-resolved by the caller when pool discovery does
   * not belong to the adapter (Blend). UPPERCASE strkey, ready to flow straight
   * into `PoolV{1,2}.load`. Absent for adapters that discover their own markets.
   */
  poolIds?: string[]
}

/**
 * A product to fetch history for, as its `products` row describes it.
 *
 * `meta` is the jsonb the adapter itself wrote at `getProducts` time — it is
 * the adapter's own vocabulary, not a shape the pipeline understands.
 */
export interface HistoryTarget {
  productId: string
  chainId: number
  kind: 'supply' | 'borrow'
  meta: Record<string, unknown>
}

export interface HistoryParams {
  startTimestamp: number // unix seconds
  endTimestamp: number // unix seconds
  interval: 'HOUR' | 'DAY'
  chainIds?: number[]
  /**
   * The products to cover, when the caller already knows them (targeted repair).
   *
   * A productId is TIMELESS; a listing predicate is not. Ingestion floors and a
   * protocol's `listed` flag describe what we collect TODAY, so applying them to
   * a question about yesterday makes a market that has since been delisted — or
   * that dipped under a floor — permanently unrepairable. So when this field is
   * present, an adapter enumerates its catalogue WITHOUT its ingestion floors,
   * intersects with the requested set, and fans out over that intersection only.
   *
   * Two things follow, and the gap-heal audit of 2026-07-24 found both missing:
   * the fetch costs what the hole costs rather than what the catalogue costs
   * (Aave was fetching ~1000 reserves to repair 216, and being rate-limited for
   * it), and a product that was asked for and not returned becomes a nameable
   * failure instead of silence.
   *
   * Absent = "everything you list" — the backfill's behaviour.
   */
  productIds?: string[]
  /**
   * The same request, enriched with each product's catalogue row. Supersedes
   * `productIds` when present.
   *
   * Dropping the ingestion floors reaches a market that dipped UNDER them, but
   * not one the protocol has stopped listing outright: enumeration cannot
   * return what the upstream no longer enumerates. Morpho's `marketById`
   * answers for such a market perfectly well — 49 hourly points for one
   * verified on 2026-07-24 — it just has to be asked by its own identifier.
   *
   * That identifier is in `meta`, because the ADAPTER put it there at
   * `getProducts` time (`underlyingToken` for Aave, `cToken` for Compound,
   * `id` for Morpho). The pipeline forwards the row untouched and stays
   * protocol-blind; each adapter reads back only what it wrote. No productId
   * is ever taken apart.
   */
  targets?: HistoryTarget[]
  /**
   * Whether to source market state (TVL/utilization/price) alongside the rates.
   * Default true. Adapters whose single upstream carries both simply ignore it;
   * for adapters that merge a SECOND, heavier source (Aave: per-reserve subgraph
   * fan-out) `false` is the cheap rates-only path — used by the hourly heal job
   * and by `--skip-market`. Never a correctness switch: an adapter that cannot
   * source market state emits NULLs either way.
   */
  includeMarket?: boolean
  onProgress?: (msg: string) => void
}

/**
 * Moved from aave/v3/apy-history.ts — contract type, not an Aave detail.
 *
 * `market` carries as much state as the protocol can source FOR THAT DAY, with
 * NULL meaning unknown — never 0, which would claim "this market holds
 * nothing". When rates and market state come from different upstreams, the
 * ADAPTER merges them by (productId, day) before returning: callers never see
 * two datasets. See src/lib/protocols/README.md.
 */
export type HistoryDataPoint = {
  timestamp: Date
  productId: string
  kind: 'supply' | 'borrow'
  apy: ApyBreakdown
  market: SupplyMarketState | BorrowMarketState
}

/** A requested product the adapter could not answer for, and why. */
export interface HistoryFailure {
  productId: string
  reason: string
}

/**
 * Points plus the requested products that produced none.
 *
 * The distinction matters because a per-product fetch error used to be a
 * `log()` and a `return null`: a rate-limit storm was indistinguishable from a
 * protocol with no history, and the heal report announced `success: true,
 * errors: []` while neighbour copies quietly filled everything in. A caller
 * that asked for specific `productIds` must be able to tell "asked, answered"
 * from "asked, failed".
 *
 * Returning a bare array stays valid — see `toHistoryResult`.
 */
export interface HistoryResult {
  points: HistoryDataPoint[]
  failures: HistoryFailure[]
}

/**
 * The floors applied AT INGESTION — in the protocol's own query, so a pool below
 * them is never even fetched.
 *
 * These are the only filters allowed in a `where` clause, and they exist for one
 * purpose: not collecting literal dust. Keep them LOW.
 *
 * They are the single irreversible decision in the pipeline. A pool we do not
 * collect has no history, and can never be given one: a market sitting at $80k that
 * grows to $500k next quarter arrives with no 30-day mean, no 180-day stddev, and
 * nothing the MCP can say about whether it is stable. Raising a floor here throws
 * away a future you cannot buy back.
 *
 * Everything else — "is this market big enough to show?", "is this rate absurd?" —
 * is decided on the READ side, in the display filters (`src/config/table-filters.ts`),
 * from the data we stored. Change a number THERE and it takes effect everywhere,
 * instantly, retroactively, with the full history intact, and it stays visible and
 * movable by the user. That is the whole reason the two layers are separate.
 *
 * Whatever is set here is honoured by every job: the 10-minute collector, the
 * hourly catalogue sync, and the heal job all read the protocol's listing rule from
 * one place — its `listing.ts` — which reads it from here.
 */
export interface IngestionFloors {
  /**
   * Morpho Blue markets: minimum borrowed USD. Morpho lists thousands of
   * permissionless markets, most of which never see a single borrow.
   */
  minBorrowAssetsUsd?: number
  /** Minimum supplied/total USD. Unset = collect everything the protocol lists. */
  minTvlUsd?: number
}

export interface YieldAdapter {
  /** Unique. = registry key = protocol_name in DB. Ex: 'aave_v3'. */
  id: string
  /** Display name. Ex: 'Aave v3'. */
  name: string
  /** Groups versions. Ex: 'aave'. = provider column. */
  provider: string
  /** Ex: 'v3'. */
  version: string
  /** chainId → chain config. Source of truth for supported chains. */
  chains: Record<number, AdapterChain>
  ingestion?: IngestionFloors
  /**
   * `false` when the adapter has no way to enumerate its own markets on-chain
   * (Blend: the factory exposes no pool list). The pipeline then pre-resolves
   * the pool set from the `products` catalogue and passes it via
   * `FetchOpts.poolIds` before calling `getProducts` / `getApySpot`. Default
   * (absent) = the adapter enumerates its markets itself.
   */
  ownsMarketDiscovery?: boolean

  getProducts(opts?: FetchOpts): Promise<(SupplyProduct | BorrowProduct)[]>
  getApySpot(opts?: FetchOpts): Promise<SpotPayload[]>
  /**
   * OPTIONAL — a protocol without a usable history source omits it; repair
   * falls back to donor hours.
   *
   * Returns either the points alone or a `HistoryResult` carrying the products
   * it could not answer for. Normalize with `toHistoryResult` rather than
   * branching at each call site.
   */
  getApyHistory?(
    params: HistoryParams
  ): Promise<HistoryDataPoint[] | HistoryResult>
}

export interface RateParams {
  poolId: string
  chainId: number
  tokenId: Address
  interval: TimeframeLabel
  fromTimestamp: number
}

/**
 * Wallet positions + UI rates + live UI product lists. Optional per protocol —
 * a yield contributor does not have to provide it.
 *
 * getSupplyProducts/getBorrowProducts are REQUIRED here even though spec §7
 * omitted them: products.actions.ts (the /supply and /borrow pages) consumes
 * them today.
 */
export interface AppAdapter {
  getUserSupplyPositions(p: { addresses: Address[] }): Promise<SupplyPosition[]>
  getUserBorrowPositions(p: { addresses: Address[] }): Promise<BorrowPosition[]>
  getMarketSupplyHistoryRates(p: RateParams): Promise<MarketRate[]>
  getMarketBorrowHistoryRates(p: RateParams): Promise<MarketRate[]>
  getSupplyProducts(): Promise<UiSupplyProduct[]>
  getBorrowProducts(): Promise<UiBorrowProduct[]>
}
