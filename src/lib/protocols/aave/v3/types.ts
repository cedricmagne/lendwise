/**
 * `protocol.meta` shapes for Aave v3 products — plugged into
 * `SupplyProduct<TMeta>` / `BorrowProduct<TMeta>` from `@/lib/db/types`.
 */

/**
 * AAVE v3 supply — a "reserve" in AAVE terminology.
 * Identified by the underlying asset address (underlyingToken).
 */
export interface AaveSupplyMeta {
  underlyingToken: string // underlying asset contract address
  aTokenSymbol: string // e.g. "aEthLidoUSDC"
  /** Maximum LTV allowed if this asset is used as collateral — e.g. 0.75 */
  maxLTV: number
  /** Liquidation threshold — position becomes liquidatable above this LTV — e.g. 0.80 */
  liquidationThreshold: number
}

/**
 * AAVE v3 borrow — same "reserve", borrow side.
 * IRM parameters fixed by governance.
 */
export interface AaveBorrowMeta {
  underlyingToken: string // underlying asset contract address
  vTokenSymbol: string // e.g. "variableDebtEthLidoUSDC"
  variableRateSlope1: number
  variableRateSlope2: number
  optimalUsageRate: number
  baseVariableBorrowRate: number
}
