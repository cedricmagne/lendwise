import { describe, expect, it } from 'vitest'

import {
  type FilterableRow,
  type TableFilter,
  fieldValue,
  matchesFilters,
} from '@/lib/table-filters'

const row = (over: Partial<FilterableRow> = {}): FilterableRow => ({
  assetAmountUsd: 1_000_000,
  liquidityAmountUsd: 400_000,
  apy: 0.05,
  apyDaily: 0.04,
  ...over,
})

describe('fieldValue', () => {
  it('reads Net APY from the column the table is currently showing', () => {
    expect(fieldValue(row(), 'netApy', 'intraday')).toBe(0.05)
    expect(fieldValue(row(), 'netApy', 'short')).toBe(0.04)
  })

  it('derives Utilization from Deposits and Liquidity, as a fraction', () => {
    expect(fieldValue(row(), 'utilization', 'intraday')).toBeCloseTo(0.6, 12)
  })

  it('reports an unknowable Utilization as undefined, never as 0', () => {
    // A zero here would be an assertion ("nothing is borrowed") on a market we
    // know nothing about — and it would diverge from SQL, where the division
    // yields NULL and the row drops out.
    expect(
      fieldValue(row({ assetAmountUsd: 0 }), 'utilization', 'intraday')
    ).toBeUndefined()
  })

  it('reports a missing horizon rate as undefined', () => {
    expect(
      fieldValue(row({ apyDaily: undefined }), 'netApy', 'short')
    ).toBeUndefined()
  })
})

describe('matchesFilters', () => {
  const deposits = (op: TableFilter['op'], value: number): TableFilter[] => [
    { field: 'deposits', op, value },
  ]

  it('applies every operator on the value the field resolves to', () => {
    expect(matchesFilters(row(), deposits('gte', 1_000_000), 'intraday')).toBe(
      true
    )
    expect(matchesFilters(row(), deposits('gt', 1_000_000), 'intraday')).toBe(
      false
    )
    expect(matchesFilters(row(), deposits('lte', 1_000_000), 'intraday')).toBe(
      true
    )
    expect(matchesFilters(row(), deposits('lt', 1_000_000), 'intraday')).toBe(
      false
    )
    expect(matchesFilters(row(), deposits('eq', 1_000_000), 'intraday')).toBe(
      true
    )
    expect(matchesFilters(row(), deposits('ne', 1_000_000), 'intraday')).toBe(
      false
    )
  })

  it('ANDs the rows — two bounds on one field is the default shape', () => {
    const bounded: TableFilter[] = [
      { field: 'netApy', op: 'lte', value: 10 },
      { field: 'netApy', op: 'gte', value: -10 },
    ]
    expect(matchesFilters(row({ apy: 0.05 }), bounded, 'intraday')).toBe(true)
    expect(matchesFilters(row({ apy: 2979.96 }), bounded, 'intraday')).toBe(
      false
    )
    expect(matchesFilters(row({ apy: -2979.96 }), bounded, 'intraday')).toBe(
      false
    )
  })

  it('lets everything through when the list is empty', () => {
    expect(matchesFilters(row({ assetAmountUsd: 0 }), [], 'intraday')).toBe(
      true
    )
  })

  it('never satisfies an operator on a missing value — not even ≠', () => {
    // The rule that keeps the two evaluators equal: SQL compares against NULL,
    // gets NULL, and drops the row. `≠` is the case that catches people out.
    const missing = row({ assetAmountUsd: undefined })
    expect(matchesFilters(missing, deposits('ne', 42), 'intraday')).toBe(false)
    expect(matchesFilters(missing, deposits('gte', 0), 'intraday')).toBe(false)
  })

  it('never satisfies an operator on a non-finite value', () => {
    expect(
      matchesFilters(
        row({ apy: NaN }),
        [{ field: 'netApy', op: 'lte', value: 10 }],
        'intraday'
      )
    ).toBe(false)
  })
})
