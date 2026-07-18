import { AAVE_V3_CHAINS } from '@/lib/protocols/aave/v3/config'
import { COMPOUND_V3_CHAINS } from '@/lib/protocols/compound/v3/config'
import { MORPHO_V1_CHAINS } from '@/lib/protocols/morpho/v1/config'

/**
 * Standardized chains — the union of every chain at least one adapter ingests,
 * i.e. every chain whose rates Lendwise standardizes to one net APY.
 *
 * This is the MARKETING number (landing stats, about page): derived, never
 * hand-counted, so it moves the day an adapter config does. The much smaller
 * execution number (wallet support) is TX_CHAIN_COUNT in `@/config/chains` —
 * do not conflate them.
 *
 * Pure data module — safe to import from server components and marketing pages
 * (no env requirement, unlike `@/config/chains`).
 */
export const STANDARDIZED_CHAIN_IDS: readonly number[] = [
  ...new Set(
    [AAVE_V3_CHAINS, MORPHO_V1_CHAINS, COMPOUND_V3_CHAINS].flatMap((chains) =>
      Object.keys(chains).map(Number)
    )
  ),
].sort((a, b) => a - b)

export const STANDARDIZED_CHAIN_COUNT = STANDARDIZED_CHAIN_IDS.length
