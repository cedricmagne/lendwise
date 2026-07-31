import type { HorizonKey } from '@/config/horizon'

import { fieldValue } from './fields'
import { OPERATORS } from './operators'
import type { FilterableRow, TableFilter } from './types'

/**
 * Does this row satisfy every filter?
 *
 * ANDed, because the list is a `where` clause and the two default rows on Net
 * APY are a two-sided bound. An empty list matches everything — that is what
 * "Clear filters" produces.
 *
 * A value we do not have satisfies NOTHING, `≠` included. In SQL any comparison
 * with NULL is NULL and the row drops out; this side has to drop it too, or the
 * two evaluators disagree on exactly the rows nobody thinks to check.
 */
export function matchesFilters(
  row: FilterableRow,
  filters: TableFilter[],
  horizon: HorizonKey
): boolean {
  return filters.every((f) => {
    const actual = fieldValue(row, f.field, horizon)
    if (actual === undefined) return false
    return OPERATORS[f.op].js(actual, f.value)
  })
}
