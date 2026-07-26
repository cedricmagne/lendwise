import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/postgres', () => ({ db: { execute: vi.fn() } }))

const { dayAlignedRange } = await import('@/lib/db/repositories/apy')

/**
 * `existingDailyKeys` answers in day-floored keys but used to filter on the raw
 * bounds it was handed. A backfill asking for "the last 3 days" passes a
 * mid-afternoon `from`, so the row of that first day — dated at midnight, hours
 * EARLIER — fell outside the probe and the day looked missing.
 *
 * Measured 2026-07-26: the dry run announced 72 insertions and the write
 * inserted 0, all 72 being the first day of the window. Third instance of the
 * same defect, after the point-vs-row count and the candidate-vs-change patch
 * count: a question asked over one range, answered in another.
 */
describe('dayAlignedRange', () => {
  it('floors the lower bound, so the first day of the window is probed', () => {
    const { from } = dayAlignedRange(
      new Date('2026-07-23T16:37:00Z'),
      new Date('2026-07-26T16:37:00Z')
    )

    expect(from.toISOString()).toBe('2026-07-23T00:00:00.000Z')
  })

  it('floors the upper bound to the day its rows are dated at', () => {
    const { to } = dayAlignedRange(
      new Date('2026-07-23T16:37:00Z'),
      new Date('2026-07-26T16:37:00Z')
    )

    expect(to.toISOString()).toBe('2026-07-26T00:00:00.000Z')
  })

  it('leaves an already day-aligned range untouched', () => {
    const range = dayAlignedRange(
      new Date('2026-07-23T00:00:00Z'),
      new Date('2026-07-26T00:00:00Z')
    )

    expect(range.from.toISOString()).toBe('2026-07-23T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-07-26T00:00:00.000Z')
  })
})
