import { NextRequest, NextResponse } from 'next/server'

import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { expectedAt } from '@/lib/db/repositories/gaps'

// ─── Slot drill-down ──────────────────────────────────────────────────────────
// Per-pool data-quality breakdown for a single (provider, hour) cell, so the
// status heatmap can answer "which pool is missing data?".

interface PoolRow {
  id: string
  protocolName: string
  chainName: string
  assetSymbol: string
  kind: string
  /** Spots reported this hour (0–6), or null when the pool reported nothing. */
  spots: number | null
  healed: boolean
}

async function slotHandler(req: NextRequest): Promise<NextResponse> {
  const provider = req.nextUrl.searchParams.get('provider')
  const hourParam = req.nextUrl.searchParams.get('hour')
  if (!provider || !hourParam) {
    return NextResponse.json(
      { error: 'provider and hour query params are required' },
      { status: 400 }
    )
  }
  const hour = new Date(hourParam)
  if (Number.isNaN(hour.getTime())) {
    return NextResponse.json({ error: 'invalid hour' }, { status: 400 })
  }

  // Spots that could have landed by now: 6 for a settled hour, but only
  // :00..:50-so-far for the live one. Scoring the in-progress hour against a
  // hard 6 reports every pool of every provider as "incomplete" for the whole
  // hour — which is what the heatmap cell already avoids via the same formula
  // (see ../route.ts). Keep the two in step or the drill-down contradicts the
  // cell it was opened from.
  const now = new Date()
  const currentHour = new Date(now)
  currentHour.setUTCMinutes(0, 0, 0)
  const expectedSpots =
    hour.getTime() === currentHour.getTime()
      ? Math.min(6, Math.floor(now.getUTCMinutes() / 10) + 1)
      : 6

  const res = await db.execute(sql`
    SELECT
      pr.id,
      pr.protocol_name AS protocol_name,
      pr.chain_name    AS chain_name,
      pr.asset_symbol  AS asset_symbol,
      pr.kind          AS kind,
      h.quality_count  AS spots,
      COALESCE(h.healed, false) AS healed
    FROM products pr
    LEFT JOIN apy_hourly h ON h.product_id = pr.id AND h.hour = ${hour}
    WHERE pr.provider = ${provider}
      -- Exactly the pools that were LISTED this hour — same predicate as the
      -- heatmap and the healer. A market created later is not "missing" for the
      -- hours before it existed; a delisted one still appears in the drill-down of
      -- an hour inside its former life, and stops appearing after it.
      AND ${expectedAt(sql.raw('pr'), sql`${hour}`)}
    ORDER BY (h.quality_count IS NULL) DESC, h.quality_count ASC, pr.asset_symbol ASC
  `)

  const pools: PoolRow[] = (
    res.rows as {
      id: string
      protocol_name: string
      chain_name: string
      asset_symbol: string
      kind: string
      spots: number | null
      healed: boolean
    }[]
  ).map((r) => ({
    id: r.id,
    protocolName: r.protocol_name,
    chainName: r.chain_name,
    assetSymbol: r.asset_symbol,
    kind: r.kind,
    spots: r.spots,
    healed: r.healed,
  }))

  // Healed pools have usable (neighbor-copied) APY even at quality_count < 6, so
  // they count as full — keeps this breakdown consistent with the heatmap, where
  // `healed` also satisfies "complete". (Missing rows never have healed=true.)
  const missing = pools.filter((p) => p.spots == null)
  const incomplete = pools.filter(
    (p) => p.spots != null && p.spots < expectedSpots && !p.healed
  )
  const full = pools.length - missing.length - incomplete.length

  return NextResponse.json({
    provider,
    hour: hour.toISOString(),
    expected: pools.length,
    expectedSpots,
    full,
    missing,
    incomplete,
  })
}

export async function GET(req: NextRequest) {
  try {
    return await slotHandler(req)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[status:quality:slot] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
