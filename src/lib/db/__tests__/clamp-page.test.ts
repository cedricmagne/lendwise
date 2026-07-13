import { describe, expect, it } from 'vitest'

import { MAX_FIRST, clampPage } from '@/lib/db/pagination'

/**
 * `first`/`skip` arrive from a public, unauthenticated GraphQL endpoint as plain
 * Ints — GraphQL has no min/max on Int, so the repository is the only guard.
 */
describe('clampPage', () => {
  it('caps first at MAX_FIRST rather than rejecting the query', () => {
    expect(clampPage({ first: 5000, skip: 0 }).first).toBe(MAX_FIRST)
    expect(clampPage({ first: MAX_FIRST, skip: 0 }).first).toBe(MAX_FIRST)
  })

  it('floors a negative first at 0 instead of emitting LIMIT -1', () => {
    // Postgres raises "LIMIT must not be negative" — a 400-class mistake would
    // otherwise surface as a 500.
    expect(clampPage({ first: -1, skip: 0 }).first).toBe(0)
    expect(clampPage({ first: -9999, skip: 0 }).first).toBe(0)
  })

  it('floors a negative skip at 0 instead of emitting OFFSET -1', () => {
    expect(clampPage({ first: 10, skip: -1 }).skip).toBe(0)
  })

  it('passes a normal page through untouched', () => {
    expect(clampPage({ first: 100, skip: 20 })).toEqual({
      first: 100,
      skip: 20,
    })
  })

  it('truncates fractional values Postgres would reject', () => {
    expect(clampPage({ first: 10.7, skip: 5.9 })).toEqual({
      first: 10,
      skip: 5,
    })
  })

  it('coerces non-finite input to a safe page', () => {
    expect(clampPage({ first: NaN, skip: NaN })).toEqual({ first: 0, skip: 0 })
    expect(clampPage({ first: Infinity, skip: Infinity })).toEqual({
      first: 0,
      skip: 0,
    })
  })
})
