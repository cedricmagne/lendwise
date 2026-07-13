import { describe, expect, it } from 'vitest'

import { deadStretches, withGaps } from '@/lib/chart-availability'

const H = 3600
const D = 24 * H

// A 30-day window, in unix seconds, with day 0 as the origin for readability.
const FROM = 0
const TO = 30 * D

describe('deadStretches', () => {
  it('finds the stretch between two listings', () => {
    // Listed day 0 → 10, dead until day 20, listed again ever since.
    expect(
      deadStretches(
        [
          { activatedAt: 0, deactivatedAt: 10 * D },
          { activatedAt: 20 * D, deactivatedAt: null },
        ],
        FROM,
        TO
      )
    ).toEqual([{ from: 10 * D, to: 20 * D }])
  })

  it('says nothing at all when the pool was listed throughout', () => {
    expect(
      deadStretches([{ activatedAt: 0, deactivatedAt: null }], FROM, TO)
    ).toEqual([])
  })

  it('never shades a chart it knows nothing about', () => {
    // No periods = "we have not established when this pool was listed", which is
    // not the same as "it was never listed". Shading here would put a confident
    // grey band over every pool's chart.
    expect(deadStretches([], FROM, TO)).toEqual([])
  })

  it('does not shade the stretch before a pool existed', () => {
    // Created on day 20: the 20 days before are not a delisting, and the line
    // starting late already says the pool is young.
    expect(
      deadStretches([{ activatedAt: 20 * D, deactivatedAt: null }], FROM, TO)
    ).toEqual([])
  })

  it('shades a pool that is delisted right now, to the edge of the window', () => {
    expect(
      deadStretches([{ activatedAt: 0, deactivatedAt: 25 * D }], FROM, TO)
    ).toEqual([{ from: 25 * D, to: TO }])
  })

  it('clips periods that start before or end after the window', () => {
    expect(
      deadStretches(
        [
          { activatedAt: -100 * D, deactivatedAt: 5 * D },
          { activatedAt: 8 * D, deactivatedAt: 100 * D },
        ],
        FROM,
        TO
      )
    ).toEqual([{ from: 5 * D, to: 8 * D }])
  })

  it('handles several dead stretches, unsorted input', () => {
    expect(
      deadStretches(
        [
          { activatedAt: 20 * D, deactivatedAt: 22 * D },
          { activatedAt: 0, deactivatedAt: 5 * D },
          { activatedAt: 10 * D, deactivatedAt: 12 * D },
        ],
        FROM,
        TO
      )
    ).toEqual([
      { from: 5 * D, to: 10 * D },
      { from: 12 * D, to: 20 * D },
      { from: 22 * D, to: TO },
    ])
  })
})

describe('withGaps', () => {
  const pts = [
    { timestamp: 1 * D, net: 0.05 },
    { timestamp: 2 * D, net: 0.06 },
    { timestamp: 9 * D, net: 0.04 },
  ]

  it('inserts one empty point inside the dead stretch, in order', () => {
    const out = withGaps(pts, [{ from: 3 * D, to: 8 * D }])
    expect(out.map((p) => p.timestamp)).toEqual([
      1 * D,
      2 * D,
      5.5 * D, // midpoint — recharts breaks the line on a nil-valued point
      9 * D,
    ])
    // The marker carries no series value: that is what makes recharts cut.
    expect('net' in out[2]).toBe(false)
  })

  it('leaves the series untouched when nothing is dead', () => {
    expect(withGaps(pts, [])).toBe(pts)
  })
})
