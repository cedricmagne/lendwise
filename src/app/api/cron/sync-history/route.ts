import { NextRequest, NextResponse } from 'next/server'

import { YIELD_ADAPTERS } from '@/config/protocols-server'
// Compound has no history in the YieldAdapter contract (see compound/v3/index.ts) —
// its one-time daily backfill is served by this direct import, a documented exception.
import { fetchCompoundDailyHistory } from '@/lib/protocols/compound/v3/apy-history'

/**
 * One-time historical APY sync endpoint.
 * Protected by CRON_SECRET. Call with:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/sync-history?protocol=aave
 *
 * Supported protocols: aave, morpho, compound
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const protocol = request.nextUrl.searchParams.get('protocol')

  const startTime = Date.now()

  try {
    let total = 0
    const errors: string[] = []

    // Reproduces today's defaults: Aave LAST_YEAR window, Morpho DAY interval,
    // both anchored to a one-year lookback ending now.
    const now = Math.floor(Date.now() / 1000)
    const yearRange = {
      startTimestamp: now - 365 * 86400,
      endTimestamp: now,
      interval: 'DAY' as const,
    }

    switch (protocol) {
      case 'aave': {
        const adapter = await YIELD_ADAPTERS['aave_v3']()
        const points = await adapter.getApyHistory!(yearRange)
        total = points.length
        break
      }
      case 'morpho': {
        const adapter = await YIELD_ADAPTERS['morpho_v1']()
        const points = await adapter.getApyHistory!(yearRange)
        total = points.length
        break
      }
      case 'compound': {
        const points = await fetchCompoundDailyHistory()
        total = points.length
        break
      }
      default:
        return NextResponse.json(
          {
            error: `Unknown or missing protocol: ${protocol}. Supported: aave, morpho, compound`,
          },
          { status: 400 }
        )
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
