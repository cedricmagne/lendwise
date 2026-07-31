import type { FilterOp } from './types'

interface OperatorDef {
  /** What the user picks in the builder. */
  label: string
  /** The object-side half. The SQL half is in `to-sql.ts`, keyed by the same union. */
  js: (a: number, b: number) => boolean
}

/**
 * Every operator, defined once.
 *
 * Numeric only. `like` / `ilike` / `in` mean nothing on a TVL and are not
 * offered; the builder only ever proposes numeric columns. `is null` /
 * `is not null` are deliberately out for now — the rest of the system
 * conflates "unknown" with "empty" on these columns, and exposing the operator
 * would force a distinction nothing else makes.
 *
 * `satisfies Record<FilterOp, …>` here and in `to-sql.ts` is what makes adding
 * an operator a compile error until BOTH sides implement it.
 */
export const OPERATORS = {
  eq: { label: '=', js: (a, b) => a === b },
  ne: { label: '≠', js: (a, b) => a !== b },
  gt: { label: '>', js: (a, b) => a > b },
  gte: { label: '≥', js: (a, b) => a >= b },
  lt: { label: '<', js: (a, b) => a < b },
  lte: { label: '≤', js: (a, b) => a <= b },
} as const satisfies Record<FilterOp, OperatorDef>

export const FILTER_OPS = Object.keys(OPERATORS) as FilterOp[]

export const isFilterOp = (v: unknown): v is FilterOp =>
  typeof v === 'string' && v in OPERATORS
