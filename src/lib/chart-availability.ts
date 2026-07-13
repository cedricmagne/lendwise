/**
 * Turning availability periods into something a chart can draw.
 *
 * A time series has two kinds of hole, and they mean opposite things:
 *
 *   - INSIDE an active period, a missing point is a collection defect. The market
 *     existed and had a rate; we just failed to record it, and the heal job will
 *     fill it in. Bridging the gap with a line is an honest interpolation.
 *   - BETWEEN two periods, the pool was not listed. There was no market and no
 *     rate. Drawing a line across it invents a trend out of nothing.
 *
 * Without the availability periods the two are indistinguishable — both are simply
 * "no row" — which is why the chart used to connect straight through a delisting.
 */

/** A stretch, in unix seconds, during which the pool was not listed. Half-open. */
export interface DeadStretch {
  from: number
  to: number
}

export interface Period {
  activatedAt: number
  /** null = still listed. */
  deactivatedAt: number | null
}

/**
 * The stretches inside [windowFrom, windowTo) that no availability period covers.
 *
 * Two deliberate omissions:
 *
 *   - No periods at all → NO stretches. An empty history means we do not know when
 *     the pool was listed (the table has not been backfilled, say), and "unknown"
 *     must never render as "dead" — that would shade the entire chart of every pool
 *     and claim, confidently, something we have not established.
 *   - The stretch BEFORE the first activation is skipped. That a pool is younger
 *     than the window is already obvious from the line starting late; shading it
 *     would bury the interesting case (a pool that vanished and came back) under
 *     noise that is on every young pool's chart.
 */
export function deadStretches(
  periods: Period[],
  windowFrom: number,
  windowTo: number
): DeadStretch[] {
  if (periods.length === 0) return []

  const sorted = [...periods].sort((a, b) => a.activatedAt - b.activatedAt)
  const stretches: DeadStretch[] = []

  // Start at the first activation, not at windowFrom — that is what skips the
  // leading "did not exist yet" stretch.
  let cursor = Math.max(sorted[0].activatedAt, windowFrom)

  for (const p of sorted) {
    const start = Math.max(p.activatedAt, windowFrom)
    const end = Math.min(p.deactivatedAt ?? windowTo, windowTo)

    if (start > cursor) stretches.push({ from: cursor, to: start })
    cursor = Math.max(cursor, end)
  }

  // The pool is currently delisted and never came back inside the window.
  if (cursor < windowTo) stretches.push({ from: cursor, to: windowTo })

  return stretches.filter((s) => s.to > s.from)
}

/**
 * A chart point with no values — only a timestamp.
 *
 * Recharts honours `connectNulls` only for a point that EXISTS with a nil value; a
 * timestamp simply absent from the array is jumped over whatever the flag says. So
 * breaking the line at a delisting means putting a real, empty point inside it.
 *
 * That is exactly the lever we want: pipeline gaps stay ABSENT (and keep bridging,
 * as before), delistings become explicit nils (and cut). One flag,
 * `connectNulls={false}`, then separates them correctly.
 */
export type GapMarker = { timestamp: number }

/**
 * Merge one empty point into each dead stretch, so the line cuts there.
 *
 * The marker sits at the midpoint rather than the edges: an edge marker can land
 * on the same timestamp as a real observation, and the two would collide in the
 * chart's x-lookup.
 */
export function withGaps<T extends { timestamp: number }>(
  points: T[],
  stretches: DeadStretch[]
): (T | GapMarker)[] {
  if (stretches.length === 0) return points

  const markers: GapMarker[] = stretches.map((s) => ({
    timestamp: Math.floor((s.from + s.to) / 2),
  }))

  return [...points, ...markers].sort((a, b) => a.timestamp - b.timestamp)
}
