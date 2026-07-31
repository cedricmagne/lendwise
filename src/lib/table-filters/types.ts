/**
 * A display filter, as DATA.
 *
 * The whole point of this module is that the predicate is not code. It is a
 * value the user edits, the browser evaluates against objects, and the API
 * compiles into a `where`. Two hand-written copies of one predicate always
 * drift — the APY pipeline produced three instances of exactly that in a single
 * week — so there is one shape here and two readers of it.
 */
export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'

/**
 * The filterable columns. A short, closed set on purpose: a builder open on the
 * whole SQL row costs a lot of UI and invites combinations nobody wants.
 *
 * The ids are stable (they are persisted in `localStorage`); the LABELS are the
 * table's column headers, and live in `fields.ts`.
 */
export type FilterFieldId = 'deposits' | 'liquidity' | 'netApy' | 'utilization'

export interface TableFilter {
  field: FilterFieldId
  op: FilterOp
  /** Canonical units: USD for money, fraction for rates (0.05 = 5 %). */
  value: number
}

/**
 * The minimum a row must carry to be judged. `SupplyProduct` and `BorrowProduct`
 * both satisfy it structurally — this type exists so the evaluator does not have
 * to import either, and so tests can hand it plain literals.
 */
export interface FilterableRow {
  assetAmountUsd?: number | null
  liquidityAmountUsd?: number | null
  apy?: number | null
  apyDaily?: number | null
  apyMonthly?: number | null
  apyYearly?: number | null
}
