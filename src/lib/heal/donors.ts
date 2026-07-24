/**
 * Choosing the hour to copy when no authoritative source can answer.
 *
 * Split out of the heal route so it can be tested without a database or a
 * signed QStash request — the route itself may only export HTTP handlers.
 */

/**
 * How far a nearest-neighbor donor may be from the hour it fills.
 *
 * This is NOT the same thing as the donor query's padding, and conflating the
 * two was a bug. The padding widens the query that FETCHES candidates, and that
 * query is bounded by the min/max hour across every gap in the run — so on a
 * report spanning a week, it fetches a week of candidates. Nothing then checked
 * how far the chosen one actually was: 19% of neighbor-healed rows were copies
 * from more than 6 hours away, and 82 of them from more than three days. A
 * Sunday APY was being written into a Tuesday hole and served as that hour's
 * rate.
 *
 * A copy is only a defensible stand-in while the rate can be assumed not to
 * have moved. Past that, an honest hole — red on /status, retried by the next
 * detection — beats a confident fabrication.
 */
export const MAX_DONOR_DISTANCE_HOURS = 6

/**
 * The closest usable donor to `targetHour`, or null when none qualifies.
 *
 * Two rules, and the first one is the whole reason this function exists
 * separately:
 *
 * 1. **The target hour is never its own donor.** For an `incomplete` gap the
 *    row already exists, so it is IN the candidate set the donor query returns,
 *    sitting at distance 0. Unguarded it wins every time and copies itself —
 *    persisted back as `quality_count: 0, healed: true`, which every later gap
 *    detection skips by design. The slot is then frozen: never repaired, never
 *    retried, and its real spot count destroyed. 3,667 rows were in that state
 *    on 2026-07-24.
 *
 * 2. **Distance is absolute and capped.** A donor may come from after the hole
 *    as readily as before it — the hour either side is equally good evidence of
 *    what the rate was — which is exactly why the cap matters.
 */
export function findNearestDonor<T extends { hour: Date }>(
  targetHour: Date,
  donors: T[]
): T | null {
  const target = targetHour.getTime()

  let best: T | null = null
  let bestDist = Infinity

  for (const donor of donors) {
    const dist = Math.abs(target - donor.hour.getTime())
    if (dist === 0) continue // rule 1 — a slot cannot repair itself
    if (dist < bestDist) {
      best = donor
      bestDist = dist
    }
  }

  return bestDist <= MAX_DONOR_DISTANCE_HOURS * 3600_000 ? best : null
}
