import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import type { FilterFieldId, FilterOp, TableFilter } from './types'

/**
 * Where each filterable field lives in a given query.
 *
 * Passed in rather than hardcoded because three shapes have to be served: the
 * `apy_hourly` table, the `apy_daily` table, and the `latest` CTE in
 * `queryLatestApy` — same column names, different aliases.
 */
export type FilterColumns = Record<FilterFieldId, SQL | AnyPgColumn>

/**
 * The shape a row-source must carry to be filterable.
 *
 * The two `last*` fields are OPTIONAL, not because they are unimportant, but
 * because not every shape this function serves has them. `apy_hourly` and the
 * `latest` CTE built over it both carry a last-observed reading per amount —
 * the running mean is the wrong quantity for a TVL/amount column, only right
 * for a rate, so `db/schema.ts` stores the slot's last value alongside the
 * mean (see the `last_*` columns there). `apy_daily` is a daily aggregate and
 * has no such column at all.
 *
 * When a `last*` field is present, every use of the corresponding quantity
 * below becomes `COALESCE(last_x, x)` — the SQL equivalent of the `last ?? mean`
 * that `latestForTable()` performs today, and exactly what the `/supply` and
 * `/borrow` tables display. When absent, the plain column is used unmodified.
 * Skipping this would compile a `where` against the running mean while the
 * table on screen renders the last observation — two evaluators agreeing with
 * each other and both disagreeing with what the user sees.
 *
 * No `borrowAssetsUsd` here: liquidity is kind-independent (see
 * `hourlyFilterColumns` below), so nothing in this module ever reads a
 * borrowed amount.
 */
interface OrderableLike {
  supplyAssetsUsd: AnyPgColumn
  utilizationRate: AnyPgColumn
  apyNet: AnyPgColumn
  lastSupplyAssetsUsd?: AnyPgColumn
  lastUtilizationRate?: AnyPgColumn
}

/** `COALESCE(last, mean)` when a last-observed column exists, else the mean column as-is. */
const displayValue = (
  mean: AnyPgColumn,
  last: AnyPgColumn | undefined
): SQL | AnyPgColumn => (last ? sql`COALESCE(${last}, ${mean})` : mean)

/**
 * The column expressions for an hourly/daily row (or the `latest` CTE).
 *
 * `liquidity` is kind-independent — there used to be a `kind` parameter here
 * that compiled a subtraction (`deposits − borrowed`) for borrow rows, on the
 * belief that the borrow presentation used it. It doesn't: both
 * `toSupplyProduct` and `toBorrowProduct` (`from-catalogue.ts`) call the very
 * same `liquidity(supplyUsd, utilizationRate)` helper on the very same
 * inputs — there is no adapter path left where a borrow row derives liquidity
 * from its own `borrow_assets_usd`. This is a literal transcription of that
 * helper:
 *
 *   - `deposits − deposits × u`, NOT `deposits × (1 − u)` — algebraically
 *     identical, but `1 − u` loses precision the same way in `double
 *     precision` as it does in a JS `number`: at u = 0.8, `1 − u` is
 *     0.19999999999999996, which drifted 1,000,000 to 199999.99999999994 (see
 *     the comment on `liquidity()` itself). Postgres `double precision` is
 *     the same IEEE-754 binary64, so it reproduces that exact drift unless
 *     the subtraction form is used here too.
 *   - `u` is clamped into `[0, 1]` (`LEAST(GREATEST(…, 0), 1)`), mirroring
 *     `Math.min(Math.max(utilization, 0), 1)`.
 *   - a NULL utilisation rate becomes 0 before the clamp
 *     (`COALESCE(utilization_rate, 0)`), mirroring `utilization ?? 0` — the
 *     one place a missing value is turned into a real number, because
 *     `from-catalogue.ts` itself makes that call.
 *
 * `utilization` is NOT compiled as `COALESCE(utilization_rate, 0)` — that would
 * read a real 0 for a market whose TVL (and therefore utilisation) is unknown,
 * while `fields.ts`'s getter refuses every operator on it. Instead it is the
 * literal transcription of `fields.ts`: `(deposits − liquidity) / NULLIF(deposits, 0)`,
 * built from the very same `deposits`/`liquidity` expressions below. It reduces
 * algebraically to `COALESCE(u, 0)` — i.e. it agrees with a naive compilation
 * everywhere that compilation was right — and it yields NULL exactly where the
 * JS side yields `undefined`: an unknown or zero deposit.
 *
 * `supply_assets_usd` is never COALESCE'd into a number when it is itself
 * unknown: an unknown TVL stays unknown rather than becoming a $0 claim.
 * `COALESCE(utilization_rate, 0)` inside the liquidity derivation is not the
 * same concession — it mirrors, exactly, the `utilization ?? 0` that
 * `from-catalogue.ts` applies when deriving liquidity, and departing from it
 * would be the divergence, not the fix.
 */
export function hourlyFilterColumns(t: OrderableLike): FilterColumns {
  const deposits = displayValue(t.supplyAssetsUsd, t.lastSupplyAssetsUsd)
  const utilizationRate = displayValue(t.utilizationRate, t.lastUtilizationRate)

  const clampedUtilization = sql`LEAST(GREATEST(COALESCE(${utilizationRate}, 0), 0), 1)`
  const liquidity = sql`(${deposits} - ${deposits} * ${clampedUtilization})`

  const utilization = sql`((${deposits} - ${liquidity}) / NULLIF(${deposits}, 0))`

  return {
    deposits,
    liquidity,
    netApy: t.apyNet,
    utilization,
  }
}

/**
 * The SQL half of each operator. Keyed by the same union as `OPERATORS.js`, and
 * `satisfies` makes a new operator a compile error until both halves exist.
 *
 * No IS NULL handling anywhere: a comparison against NULL yields NULL and the
 * row drops out — which is precisely the behaviour `matchesFilters` reproduces
 * by refusing every operator on a missing value.
 */
const SQL_OPS = {
  eq: (col, v) => sql`${col} = ${v}`,
  ne: (col, v) => sql`${col} <> ${v}`,
  gt: (col, v) => sql`${col} > ${v}`,
  gte: (col, v) => sql`${col} >= ${v}`,
  lt: (col, v) => sql`${col} < ${v}`,
  lte: (col, v) => sql`${col} <= ${v}`,
} as const satisfies Record<
  FilterOp,
  (col: SQL | AnyPgColumn, value: number) => SQL
>

/**
 * Compile a filter list into `where` conditions. ANDed by the caller, exactly
 * as `matchesFilters` ANDs them; an empty list yields no conditions.
 *
 * `apy_net` is NOT NULL in both tables but can hold NaN, which Postgres sorts
 * above every real number. The finiteness guard stays where it is
 * (`finiteApy()` in the repository) — this function only ever emits the user's
 * predicate.
 */
export function toSqlConds(
  filters: TableFilter[],
  columns: FilterColumns
): SQL[] {
  return filters.map((f) => SQL_OPS[f.op](columns[f.field], f.value))
}
