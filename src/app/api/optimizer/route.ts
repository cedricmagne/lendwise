import { NextRequest, NextResponse } from 'next/server'

import { getPostHogClient } from '@/lib/posthog-server'

/**
 * Generic Proxy for the Yield Optimizer API
 * External API: https://optimizer.lendwise.fi/redoc
 *
 * Usage: POST /api/optimizer with body { endpoint: '/optimize/vaults', data: {...} }
 */

const OPTIMIZER_API_URL = process.env.OPTIMIZER_API_URL

// Allowed endpoints to proxy (whitelist for security)
const ALLOWED_ENDPOINTS = [
  '/health',
  '/optimize/vaults',
  '/optimize/borrow',
  '/optimize/collateral',
  '/breakpoints/borrow',
  '/breakpoints/collateral',
] as const

type AllowedEndpoint = (typeof ALLOWED_ENDPOINTS)[number]

interface ProxyRequest {
  endpoint: AllowedEndpoint
  data?: unknown
}

interface ApiErrorDetail {
  loc: (string | number)[]
  msg: string
  type: string
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

    const body = (await request.json()) as ProxyRequest

    // Validate endpoint
    if (!body.endpoint) {
      return NextResponse.json(
        { error: 'endpoint is required' },
        { status: 400 }
      )
    }

    if (!ALLOWED_ENDPOINTS.includes(body.endpoint as AllowedEndpoint)) {
      return NextResponse.json(
        { error: `Invalid endpoint: ${body.endpoint}` },
        { status: 400 }
      )
    }

    // Determine HTTP method based on endpoint
    const method = body.endpoint === '/health' ? 'GET' : 'POST'

    // Call external API
    const response = await fetch(`${OPTIMIZER_API_URL}${body.endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      ...(method === 'POST' && body.data
        ? { body: JSON.stringify(body.data) }
        : {}),
    })

    if (!response.ok) {
      const errorData = (await response.json()) as { detail?: ApiErrorDetail[] }
      const errorMessage =
        errorData.detail?.map((d) => d.msg).join(', ') ||
        `External API error: ${response.status}`
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    const data = await response.json()

    const distinctId =
      request.headers.get('x-posthog-distinct-id') ?? 'anonymous'
    const posthog = getPostHogClient()
    posthog.capture({
      distinctId,
      event: 'optimizer_api_called',
      properties: {
        endpoint: body.endpoint,
        status: response.status,
      },
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('Optimizer API error:', error)
    return NextResponse.json(
      { error: 'Failed to call optimizer API' },
      { status: 500 }
    )
  }
}
