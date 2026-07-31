import { describe, expect, it } from 'vitest'

import { parseStoredFilters, serializeFilters } from '@/lib/table-filters'

describe('parseStoredFilters', () => {
  it('round-trips a filter list', () => {
    const filters = [
      { field: 'deposits', op: 'gte', value: 100_000 },
      { field: 'netApy', op: 'lte', value: 10 },
    ] as const
    expect(parseStoredFilters(serializeFilters([...filters]))).toEqual([
      ...filters,
    ])
  })

  it('distinguishes a deliberate empty list from an absent one', () => {
    // "Clear filters" must survive a reload. If [] fell back to the defaults,
    // the user would clear the floor, come back tomorrow, and find it restored
    // with no explanation.
    expect(parseStoredFilters('[]')).toEqual([])
    expect(parseStoredFilters(null)).toBeNull()
  })

  it('falls back on anything it cannot trust', () => {
    expect(parseStoredFilters('not json')).toBeNull()
    expect(parseStoredFilters('{"field":"deposits"}')).toBeNull()
    expect(parseStoredFilters('[{"field":"deposits","op":"gte"}]')).toBeNull()
    expect(
      parseStoredFilters('[{"field":"deposits","op":"gte","value":"1e5"}]')
    ).toBeNull()
    expect(
      parseStoredFilters('[{"field":"deposits","op":"gte","value":null}]')
    ).toBeNull()
  })

  it('rejects a field or operator this build no longer knows', () => {
    // A filterable column can be renamed or dropped between releases. A stored
    // predicate naming one is not repairable — falling back to the defaults is,
    // and the user sees a set that at least means something.
    expect(
      parseStoredFilters('[{"field":"empty_market","op":"gte","value":1}]')
    ).toBeNull()
    expect(
      parseStoredFilters('[{"field":"deposits","op":"ilike","value":1}]')
    ).toBeNull()
  })

  it('rejects a non-finite value', () => {
    expect(
      parseStoredFilters('[{"field":"deposits","op":"gte","value":1e999}]')
    ).toBeNull()
  })
})
