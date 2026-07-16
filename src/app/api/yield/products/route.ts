import { type NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import { syncProducts } from '@/app/actions/products-sync.actions'
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'

/**
 * Pools sync endpoint.
 *
 * Fetches static pool metadata (collaterals, protocolMeta, addresses) from every
 * protocol, upserts it, and reconciles `product_availability_periods` — opening a
 * period for a newly listed or relisted pool, closing one for a pool the provider
 * no longer returns.
 *
 * Body (JSON):
 *   protocol (optional): 'aave_v3' | 'morpho_v1' | 'compound_v3'
 *   If omitted, all protocols are synced.
 *
 * Triggered by QStash HOURLY (`5 * * * *`). The cadence is the resolution of the
 * availability history: this sync is a poll, not an event stream, so a listing
 * change is only ever known to within one run of it. Daily meant a delisted pool
 * stayed "expected" for up to 24 hours — a day of phantom gaps on /status, and a
 * day of the heal job trying to refetch a market that no longer exists.
 *
 * A provider whose enumeration FAILS is skipped entirely. Its products keep their
 * periods: an empty list from a broken fetch must never be read as "they delisted
 * everything".
 */
export const POST = verifySignatureAppRouter(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const protocol = body.protocol as string | undefined

  if (protocol) {
    const validIds = Object.keys(PROTOCOLS_META)
    if (!validIds.includes(protocol)) {
      return NextResponse.json(
        {
          error: `Invalid protocol: "${protocol}". Supported: ${validIds.join(', ')}`,
        },
        { status: 400 }
      )
    }
  }

  try {
    const result = await syncProducts(protocol as ProtocolName | undefined)

    return NextResponse.json(result, {
      status: result.success ? 200 : 207,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron:pools-sync] Unhandled error:', message)

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
})
