import { NextResponse } from 'next/server'

/**
 * API discovery index.
 *
 * Lists the public API surface only. Frontend-only data needs go through
 * server actions (src/app/actions/), not routes; pipeline routes
 * (/api/yield/*, /api/cron/*) are QStash/secret-protected and never meant to
 * be called directly. Neither belongs here — see
 * agent/specs/2026-07-22-api-endpoints-map.md.
 */
export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(
    {
      name: 'Lendwise API',
      description:
        'Unified layer for DeFi lending — standardized net APY across 700+ markets.',
      documentation: 'https://lendwise.fi/docs/api/',
      endpoints: {
        graphql: {
          url: '/api/graphql',
          methods: ['GET', 'POST'],
          description:
            'Public read-only GraphQL API. Introspectable; open the URL in a browser for GraphiQL. Rate limited to 60 requests/min/IP.',
        },
        stats: {
          url: '/api/stats',
          methods: ['GET'],
          description:
            'Platform stats: standardized chains, lending markets, assets. Cached 1 hour, CORS open.',
        },
        optimizer: {
          url: '/api/optimizer',
          methods: ['POST'],
          description:
            'Yield optimizer proxy. Body: { endpoint, data }. Rate limited to 10 requests/min/IP. Upstream reference: https://optimizer.lendwise.fi/redoc',
        },
      },
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  )
}
