/**
 * `protocol.meta` shapes for Morpho Blue v1 products — plugged into
 * `SupplyProduct<TMeta>` / `BorrowProduct<TMeta>` from `@/lib/db/types`.
 */

/**
 * Morpho Blue borrow — a market, borrow side (Blue markets are supply +
 * borrow on the loan asset; the loan-asset supply side is not surfaced as
 * its own product — see MetaMorphoSupplyMeta for the vault supply side).
 */
export interface MorphoBlueBorrowMeta {
  id: string // marketId hash
  lltv: number // liquidation LTV for this market — e.g. 0.915
}

/**
 * MetaMorpho supply — a "vault" built on top of Morpho Blue markets.
 * No borrow side — vaults are supply-only.
 *
 * `id` and `address` both carry the vault contract address — `getApyHistory`
 * reads `meta.id ?? meta.address` (see `./apy-history.ts`), so both stay
 * required rather than collapsing into one field.
 */
export interface MetaMorphoSupplyMeta {
  id: string
  address: string // vault contract address
  name: string
  symbol: string
  curators: string[] // e.g. ["Steakhouse", "Gauntlet"]
}
