import { isFilterFieldId } from './fields'
import { isFilterOp } from './operators'
import type { TableFilter } from './types'

/**
 * Versioned keys. A `.v2` is how a breaking change to the shape gets shipped
 * without every user meeting a parse failure on their first page load.
 */
export const SUPPLY_FILTERS_KEY = 'lendwise.tableFilters.supply.v1'
export const BORROW_FILTERS_KEY = 'lendwise.tableFilters.borrow.v1'

export const serializeFilters = (filters: TableFilter[]): string =>
  JSON.stringify(filters)

const isTableFilter = (v: unknown): v is TableFilter => {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return (
    isFilterFieldId(f.field) &&
    isFilterOp(f.op) &&
    typeof f.value === 'number' &&
    Number.isFinite(f.value)
  )
}

/**
 * A stored filter list, or null when there is nothing usable.
 *
 * Null means "fall back to the defaults" — an absent key, malformed JSON, or a
 * predicate naming a field this build has dropped. An EMPTY ARRAY is not null:
 * it is the user having cleared every filter, and it has to survive a reload
 * or "Clear filters" would silently undo itself overnight.
 *
 * All-or-nothing on purpose. Keeping the valid half of a list the user cannot
 * see would show them a filtered table they never configured.
 */
export function parseStoredFilters(raw: string | null): TableFilter[] | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    if (!parsed.every(isTableFilter)) return null
    return parsed
  } catch {
    return null
  }
}
