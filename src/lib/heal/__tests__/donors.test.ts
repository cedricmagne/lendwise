import { describe, expect, it } from 'vitest'

import { MAX_DONOR_DISTANCE_HOURS, findNearestDonor } from '@/lib/heal/donors'

const at = (iso: string) => ({ hour: new Date(iso) })

describe('findNearestDonor', () => {
  const target = new Date('2026-07-20T12:00:00.000Z')

  it('never uses the target hour as its own donor', () => {
    // The slot being repaired is IN the donor set: the donor query fetches a
    // window, and an `incomplete` gap is a row that already exists. Left
    // unguarded it sits at distance 0, wins, and copies itself — coming back
    // quality_count 0 and healed=true, which every later gap detection skips.
    // 3,667 rows were frozen that way.
    const donor = findNearestDonor(target, [
      at('2026-07-20T12:00:00.000Z'),
      at('2026-07-20T14:00:00.000Z'),
    ])

    expect(donor?.hour.toISOString()).toBe('2026-07-20T14:00:00.000Z')
  })

  it('returns null when the target is the only candidate', () => {
    expect(
      findNearestDonor(target, [at('2026-07-20T12:00:00.000Z')])
    ).toBeNull()
  })

  it('picks the closest remaining candidate', () => {
    const donor = findNearestDonor(target, [
      at('2026-07-20T08:00:00.000Z'),
      at('2026-07-20T11:00:00.000Z'),
      at('2026-07-20T15:00:00.000Z'),
    ])

    expect(donor?.hour.toISOString()).toBe('2026-07-20T11:00:00.000Z')
  })

  it('accepts a donor from after the hole as readily as before it', () => {
    const donor = findNearestDonor(target, [
      at('2026-07-20T09:00:00.000Z'),
      at('2026-07-20T13:00:00.000Z'),
    ])

    expect(donor?.hour.toISOString()).toBe('2026-07-20T13:00:00.000Z')
  })

  it('refuses a donor further than the cap', () => {
    const tooFar = new Date(
      target.getTime() + (MAX_DONOR_DISTANCE_HOURS + 1) * 3600_000
    )

    expect(findNearestDonor(target, [{ hour: tooFar }])).toBeNull()
  })

  it('accepts a donor exactly at the cap', () => {
    const atCap = new Date(
      target.getTime() + MAX_DONOR_DISTANCE_HOURS * 3600_000
    )

    expect(findNearestDonor(target, [{ hour: atCap }])?.hour).toEqual(atCap)
  })

  it('returns null for an empty candidate set', () => {
    expect(findNearestDonor(target, [])).toBeNull()
  })
})
