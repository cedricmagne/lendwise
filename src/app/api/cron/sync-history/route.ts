import { NextRequest, NextResponse } from 'next/server'

import { adapterIdsForProvider } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { toHistoryResult } from '@/lib/protocols/core/history-result'

/**
 * One-time historical APY sync endpoint.
 * Protected by CRON_SECRET. Call with:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/sync-history?protocol=aave
 *
 * `protocol` is a provider name — every adapter version under it that declares
 * getApyHistory is fetched. Compound used to be a hardcoded case here, calling
 * fetchCompoundDailyHistory directly because its adapter did not declare the
 * method; now that it does, all three providers go through the same path.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const protocol = request.nextUrl.searchParams.get('protocol') ?? ''
  const startTime = Date.now()

  const adapterIds = adapterIdsForProvider(protocol)
  if (adapterIds.length === 0) {
    return NextResponse.json(
      { error: `Unknown or missing protocol: ${protocol || '(none)'}` },
      { status: 400 }
    )
  }

  try {
    let total = 0
    const errors: string[] = []

    // Reproduces today's defaults: Aave LAST_YEAR window, Morpho DAY interval,
    // both anchored to a one-year lookback ending now.
    //
    // includeMarket: false — this route only COUNTS the points it fetched; the
    // per-reserve market-state fan-out (~1k subgraph requests for Aave) buys it
    // nothing and would blow the request budget. Market state is backfilled by
    // scripts/backfill-history.ts, which persists what it fetches.
    const now = Math.floor(Date.now() / 1000)
    const yearRange = {
      startTimestamp: now - 365 * 86400,
      endTimestamp: now,
      interval: 'DAY' as const,
      includeMarket: false,
    }

    for (const adapterId of adapterIds) {
      const adapter = await YIELD_ADAPTERS[adapterId]()
      if (!adapter.getApyHistory) {
        errors.push(`${adapterId}: no getApyHistory`)
        continue
      }
      const { points } = toHistoryResult(await adapter.getApyHistory(yearRange))
      total += points.length
    }

    return NextResponse.json({
      success: errors.length === 0,
      protocol,
      total,
      errors,
      durationMs: Date.now() - startTime,
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        protocol,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    )
  }
}
