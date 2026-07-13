/**
 * The one and only guard the ingestion pipeline is allowed to apply.
 *
 * `/status` answers a single question: "did the protocol API respond, and did we
 * store what it said?" It must NOT answer "is this rate plausible?". Those are
 * different concerns, and mixing them corrupts both:
 *
 *   - A snapshot dropped for being implausible leaves no hourly row → gap
 *     detection reports a MISSING slot → the heal job refetches the same hour
 *     from the protocol's history API → gets the same implausible value back →
 *     writes it unguarded. The plausibility filter manufactures the very gap
 *     that smuggles the value in through the back door. (Every single one of the
 *     479 rows above 100 in apy_hourly is `healed = true`. All of them.)
 *   - And the status page lies: a red "missing" cell that really means "we got
 *     the data and threw it away".
 *
 * So: a finite value the API actually returned is real data. Store it, whatever
 * its magnitude — a market can genuinely quote an absurd rate. Only a value that
 * is not a number at all (`NaN`, `±Infinity`) is un-storable, and its absence is
 * an honest ingestion failure worth colouring the heatmap for.
 *
 * Deciding whether a stored rate is fit to SHOW is display eligibility, and it
 * lives on the read side (TVL floors, outlier flags) — never here.
 */

interface ApyBlock {
  base: number
  rewards: number
  fees: number
  net: number
}

/** True when every APY component is an actual number we can persist. */
export function isFiniteApyBlock(apy: ApyBlock): boolean {
  return (
    Number.isFinite(apy.base) &&
    Number.isFinite(apy.rewards) &&
    Number.isFinite(apy.fees) &&
    Number.isFinite(apy.net)
  )
}
