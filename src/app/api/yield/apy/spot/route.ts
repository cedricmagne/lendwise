import { NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import { collectApySpot } from '@/app/actions/apy-snapshots.actions'
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'

/**
 * Spot APY snapshot endpoint.
 *
 * Collects APY snapshots from the requested protocol and upserts them into the
 * apy_hourly Postgres table (one rolling-average row per product per hour).
 *
 * Body (JSON):
 *   protocol (required): 'aave_v3' | 'morpho_v1' | 'compound_v3'
 *
 * Triggered by QStash every 10 minutes — one request per protocol.
 */
export const POST = verifySignatureAppRouter(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const protocol = body.protocol as string | undefined

  if (!protocol) {
    return NextResponse.json(
      { error: 'Missing required parameter: protocol' },
      { status: 400 }
    )
  }

  const validIds = Object.keys(PROTOCOLS_META)
  if (!validIds.includes(protocol)) {
    return NextResponse.json(
      {
        error: `Invalid protocol: "${protocol}". Supported: ${validIds.join(', ')}`,
      },
      { status: 400 }
    )
  }

  try {
    const result = await collectApySpot(protocol as ProtocolName)

    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[cron:spot] Unhandled error for protocol ${protocol}:`,
      message
    )

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
})
