/**
 * `protocol.meta` shape for Compound v3 products — plugged into
 * `SupplyProduct<TMeta>` / `BorrowProduct<TMeta>` from `@/lib/db/types`.
 */

/**
 * Compound v3 market — a "Comet" contract, both supply and borrow sides.
 * Identified by the Comet contract address (cToken field name kept for
 * continuity with Compound v2 terminology).
 */
export interface CompoundMarketMeta {
  cToken: string // Comet contract address
  reserveFactor: number // e.g. 0.10
}
