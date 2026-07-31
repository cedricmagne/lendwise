import { HORIZON_CONFIG, type HorizonKey } from '@/config/horizon'

import type { FilterFieldId, FilterableRow } from './types'

interface FilterFieldDef {
  /**
   * The table's column header, verbatim. The selector offers what the user
   * reads on screen, not a SQL column — which is also what settles, on the
   * borrow table, whether the filter means Deposits or Liquidity.
   */
  label: string
  /** `usd` renders as $, `fraction` renders as % (value × 100). */
  unit: 'usd' | 'fraction'
  /** The row's value in canonical units, or undefined when we cannot know it. */
  get: (row: FilterableRow, horizon: HorizonKey) => number | undefined
}

const num = (v: number | null | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

export const FILTER_FIELDS = {
  deposits: {
    label: 'Deposits',
    unit: 'usd',
    get: (row) => num(row.assetAmountUsd),
  },
  liquidity: {
    label: 'Liquidity',
    unit: 'usd',
    get: (row) => num(row.liquidityAmountUsd),
  },
  netApy: {
    // Follows the column on screen: at the 7D horizon the header reads
    // "APY (7D avg)" and the filter judges that same average. Filtering the spot
    // while displaying the mean would be the divergence this design exists to
    // remove.
    label: 'Net APY',
    unit: 'fraction',
    get: (row, horizon) =>
      num(row[HORIZON_CONFIG[horizon].apyKey] as number | undefined),
  },
  utilization: {
    // Derived from the two columns beside it, NOT from apy_hourly's stored
    // `utilization_rate` — that one is the protocol's own figure and does not
    // always agree. `to-sql.ts` computes the same ratio.
    label: 'Utilization',
    unit: 'fraction',
    get: (row) => {
      const deposits = num(row.assetAmountUsd)
      const liquidity = num(row.liquidityAmountUsd)
      if (deposits === undefined || liquidity === undefined) return undefined
      // A zero-deposit market has no utilisation to report. Returning 0 would
      // assert "nothing borrowed" about a market we know nothing about, and it
      // would diverge from SQL, where the division by zero yields NULL.
      if (deposits === 0) return undefined
      return (deposits - liquidity) / deposits
    },
  },
} as const satisfies Record<FilterFieldId, FilterFieldDef>

export const FILTER_FIELD_IDS = Object.keys(FILTER_FIELDS) as FilterFieldId[]

export const isFilterFieldId = (v: unknown): v is FilterFieldId =>
  typeof v === 'string' && v in FILTER_FIELDS

/** The row's value for a field, in canonical units. */
export function fieldValue(
  row: FilterableRow,
  field: FilterFieldId,
  horizon: HorizonKey
): number | undefined {
  return FILTER_FIELDS[field].get(row, horizon)
}

/**
 * Canonical → what the user types and reads (fractions become percent).
 *
 * The `fraction` branch rounds off float noise from the ×100 conversion —
 * `0.9 * 100` is `90.00000000000001` in IEEE 754, and an unrounded value
 * re-rendered straight into the input garbles on every keystroke. 12-13
 * significant digits is far more precision than a percentage input needs.
 * The `usd` branch has no such multiplication and does not need rounding.
 */
export const toDisplayValue = (field: FilterFieldId, value: number): number =>
  FILTER_FIELDS[field].unit === 'fraction'
    ? Math.round(value * 100 * 1e10) / 1e10
    : value

/** What the user typed → canonical. */
export const fromDisplayValue = (
  field: FilterFieldId,
  value: number
): number => (FILTER_FIELDS[field].unit === 'fraction' ? value / 100 : value)

/**
 * The value as it appears on a chip: "$100K", "1000%".
 *
 * Always USD, never the user's display currency: the threshold is defined in
 * dollars on both surfaces, and converting it on screen would make the same
 * filter read differently to two users.
 */
export function formatFilterValue(field: FilterFieldId, value: number): string {
  const def = FILTER_FIELDS[field]
  if (def.unit === 'fraction') {
    const pct = value * 100
    return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
