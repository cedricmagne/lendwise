import { NextRequest, NextResponse } from 'next/server'

import { z } from 'zod'

import { getPostHogClient } from '@/lib/posthog-server'
import { clientIp, optimizerLimiter } from '@/lib/ratelimit'

/**
 * Generic proxy for the Yield Optimizer API.
 * External API: https://optimizer.lendwise.fi/redoc
 *
 * Usage: POST /api/optimizer with body { endpoint: '/optimize/vaults', data: {...} }
 *
 * This proxy is the ONLY rate-limit chokepoint in front of the solver — nothing
 * we ship calls optimizer.lendwise.fi directly. The solver is CPU-bound, so both
 * the request rate and the input size have to be bounded here.
 */

const OPTIMIZER_API_URL = process.env.OPTIMIZER_API_URL

/** Upstream is CPU-bound; without this a hung solver holds the function open to Vercel's 300s ceiling. */
const UPSTREAM_TIMEOUT_MS = 10_000

/** Solver cost grows with market count. 200 is far above any real portfolio. */
const MAX_MARKETS = 200

/**
 * Body cap, enforced before `request.json()`. Zod bounds what reaches the solver,
 * but only after the whole body has been read and parsed — so without this, a
 * multi-megabyte payload still costs us the parse. A legitimate request at
 * MAX_MARKETS is a few KB.
 */
const MAX_BODY_BYTES = 64 * 1024

interface ApiErrorDetail {
  loc: (string | number)[]
  msg: string
  type: string
}

// ─── Input validation ────────────────────────────────────────────────────────

/** Zod 4's z.number() already rejects NaN and Infinity, both of which would reach the solver. */
const finite = z.number()

const marketArray = z.array(finite).min(1).max(MAX_MARKETS)

const marketData = z.object({
  max_ltv: marketArray,
  rates: marketArray,
  liquidity: marketArray,
  price: finite.positive().optional(),
})

const vaultAllocation = z.object({
  apy: marketArray,
  diversification: finite.min(0).max(100).optional(),
})

const optimalBorrow = z.object({
  collateral_amount: finite.nonnegative(),
  omega: finite.min(0).max(1).optional(),
  markets: marketData,
})

const optimalCollateral = z.object({
  borrow_amount: finite.nonnegative(),
  omega: finite.min(0).max(1).optional(),
  markets: marketData,
})

const breakpointsBorrow = z.object({
  collateral_amount: finite.nonnegative(),
  markets: marketData,
})

const breakpointsCollateral = z.object({
  borrow_amount: finite.nonnegative(),
  markets: marketData,
})

/**
 * The proxy whitelist, each endpoint bound to the schema of its payload.
 * An endpoint absent from this map cannot be reached.
 */
const ENDPOINTS = {
  '/health': null,
  '/optimize/vaults': vaultAllocation,
  '/optimize/borrow': optimalBorrow,
  '/optimize/collateral': optimalCollateral,
  '/breakpoints/borrow': breakpointsBorrow,
  '/breakpoints/collateral': breakpointsCollateral,
} as const

type AllowedEndpoint = keyof typeof ENDPOINTS

function isAllowedEndpoint(value: unknown): value is AllowedEndpoint {
  return typeof value === 'string' && value in ENDPOINTS
}

/** The three MarketData arrays are positional — a length mismatch silently misaligns markets. */
function marketsAligned(data: unknown): boolean {
  const markets = (data as { markets?: z.infer<typeof marketData> })?.markets
  if (!markets) return true
  const { max_ltv, rates, liquidity } = markets
  return max_ltv.length === rates.length && max_ltv.length === liquidity.length
}

// ============================================================================
// POST /api/optimizer - Generic proxy to external optimizer API
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    if (!OPTIMIZER_API_URL) {
      console.error('OPTIMIZER_API_URL environment variable is not set')
      return NextResponse.json(
        { error: 'Optimizer service is not configured' },
        { status: 503 }
      )
    }

    const { success, retryAfter } = await optimizerLimiter.limit(
      clientIp(request.headers)
    )
    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    // Content-Length can be absent or lie (chunked encoding), so measure what we
    // actually read rather than trusting the header.
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    let body: { endpoint?: unknown; data?: unknown }
    try {
      body = JSON.parse(raw) as { endpoint?: unknown; data?: unknown }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!isAllowedEndpoint(body.endpoint)) {
      return NextResponse.json(
        { error: `Invalid endpoint: ${String(body.endpoint)}` },
        { status: 400 }
      )
    }
    const endpoint = body.endpoint
    const schema = ENDPOINTS[endpoint]

    // /health takes no payload; everything else is validated before it costs us a solver run.
    let data: unknown
    if (schema) {
      const parsed = schema.safeParse(body.data)
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Invalid payload',
            details: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          { status: 400 }
        )
      }
      if (!marketsAligned(parsed.data)) {
        return NextResponse.json(
          {
            error:
              'markets.max_ltv, markets.rates and markets.liquidity must have the same length',
          },
          { status: 400 }
        )
      }
      data = parsed.data
    }

    const method = endpoint === '/health' ? 'GET' : 'POST'

    const response = await fetch(`${OPTIMIZER_API_URL}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      ...(method === 'POST' && data ? { body: JSON.stringify(data) } : {}),
    })

    if (!response.ok) {
      // The error body is not necessarily JSON: a dead/misrouted upstream answers
      // with an HTML or plain-text page, and blindly calling response.json() here
      // throws, which the outer catch would report as a generic 500 — hiding the
      // real upstream status. Read as text, then parse only if it parses.
      const raw = await response.text()
      let errorMessage = `External API error: ${response.status}`
      try {
        const parsed = JSON.parse(raw) as { detail?: ApiErrorDetail[] }
        const detail = parsed.detail?.map((d) => d.msg).join(', ')
        if (detail) errorMessage = detail
      } catch {
        if (raw.trim()) errorMessage = `${errorMessage}: ${raw.slice(0, 200)}`
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    const result = await response.json()

    const distinctId =
      request.headers.get('x-posthog-distinct-id') ?? 'anonymous'
    const posthog = getPostHogClient()
    posthog?.capture({
      distinctId,
      event: 'optimizer_api_called',
      properties: {
        endpoint,
        status: response.status,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    // AbortSignal.timeout rejects with a TimeoutError — report it as an upstream
    // timeout (504) rather than a generic 500, so a slow solver is diagnosable.
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error('Optimizer API timed out')
      return NextResponse.json(
        { error: 'Optimizer service timed out' },
        { status: 504 }
      )
    }
    console.error('Optimizer API error:', error)
    return NextResponse.json(
      { error: 'Failed to call optimizer API' },
      { status: 500 }
    )
  }
}
