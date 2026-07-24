import { MORPHO_V1_INGESTION } from './config'

/**
 * What Morpho lists — the single answer, for every caller.
 *
 * Morpho's listing rule is not a predicate on a fetched object, the way Aave's is:
 * it is the `where` clause of the query itself. Which means the two jobs that
 * enumerate Morpho — the 10-minute APY collector and the hourly catalogue sync —
 * were each carrying their own copy of it, and agreed only because someone had
 * copy-pasted carefully:
 *
 *   apy-spot.ts   markets: { listed, chainId_in, borrowAssetsUsd_gte: 10000 }
 *   products.ts   markets: { chainId_in, borrowAssetsUsd_gte: 10000, listed }
 *
 * Identical today, and nothing whatsoever holds them there. Change the floor in one
 * file and the collector starts writing rows for markets the catalogue will not
 * register (orphans, invisible to every read path) — or the catalogue starts
 * registering markets the collector never visits (permanent gaps on /status, and a
 * heal job forever refetching a pool nobody collects). Aave already drifted exactly
 * this way, three predicates deep.
 *
 * So the filter lives here, once, and both jobs ask for it.
 */

/**
 * The ingestion floors — set once, in the protocol config, honoured by every job
 * that reads this file: the collector, the catalogue sync, and the heal.
 *
 * The ONLY filter we allow in a query's `where`, and only because it is about not
 * collecting dust. Whether a collected market is big enough to SHOW is a different
 * question with a different owner: `lib/display-eligibility`, on the read side,
 * where changing your mind is a one-line, retroactive edit rather than a hole in
 * the history you can never fill.
 */
const floors = MORPHO_V1_INGESTION

/**
 * `unfloored` drops the ingestion floors from the `where`.
 *
 * ONLY for a caller that already knows which productIds it wants — a targeted
 * history refetch. The floors describe what we collect TODAY; applying them to a
 * question about a PAST hour makes a market that has since dipped under them
 * permanently unrepairable. One market oscillating between $10,766 and $10,990
 * of borrow produced exactly that: under the floor the collector skipped it, and
 * the refetch could not see it either, so the hole was filled by copying a
 * neighbouring hour instead.
 *
 * Never pass it on an enumeration whose result gets COLLECTED — ingestion is the
 * one irreversible filter in the pipeline.
 */
export interface ListingOpts {
  unfloored?: boolean
}

/** The markets (Morpho Blue) we list — i.e. the borrow side. */
export function morphoMarketWhere(chainIds: number[], opts?: ListingOpts) {
  return {
    listed: true,
    chainId_in: chainIds,
    ...(!opts?.unfloored &&
      floors.minBorrowAssetsUsd != null && {
        borrowAssetsUsd_gte: floors.minBorrowAssetsUsd,
      }),
  }
}

/**
 * The vaults (MetaMorpho) we list — i.e. the supply side.
 *
 * Unfloored unless the config says otherwise. A vault's TVL is legitimately near
 * zero while it is being seeded, and its APY is meaningful long before it is big.
 */
export function morphoVaultWhere(chainIds: number[], opts?: ListingOpts) {
  return {
    listed: true,
    chainId_in: chainIds,
    ...(!opts?.unfloored &&
      floors.minTvlUsd != null && { totalAssetsUsd_gte: floors.minTvlUsd }),
  }
}
