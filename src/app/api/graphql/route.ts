import { EnvelopArmor } from '@escape.tech/graphql-armor'
import { type Plugin, createYoga } from 'graphql-yoga'

import { schema } from '@/lib/graphql/schema'
import { clientIp, graphqlLimiter } from '@/lib/ratelimit'

/**
 * Public, read-only GraphQL API. Unauthenticated and introspectable by design —
 * MCP codegen depends on introspection. What bounds it is cost, not auth.
 *
 * Introspection survives these limits: `maxDepth` and `costLimit` both default to
 * `ignoreIntrospection: true`, and the standard introspection query lexes to ~163
 * tokens, well under the 1000-token cap.
 */
/**
 * maxCost is 75_000, not the 5_000 the design spec named. Armor's cost model
 * multiplies by the `first` argument (~113 × first for a full selection set), so
 * 5_000 rejected everything above `first: 44` — including the schema's own
 * default of 100, and the 500 that MAX_FIRST clamps to. It made the API unusable
 * rather than bounded.
 *
 * 75_000 admits exactly one full-size query (`first: 500` ≈ 56_600) while still
 * rejecting the abuse this plugin is here for: 8 aliased full-size queries cost
 * ~453_000. Row count is really bounded by MAX_FIRST server-side; cost limiting
 * is the second line, not the first.
 */
const armor = new EnvelopArmor({
  maxDepth: { n: 8 },
  maxAliases: { n: 8 },
  maxDirectives: { n: 10 },
  maxTokens: { n: 1000 },
  costLimit: { maxCost: 75_000 },
})

/**
 * Rejects over-limit callers in `onRequest` — before parse/validate — so a
 * rejected request never reaches the schema.
 */
const rateLimitPlugin: Plugin = {
  async onRequest({ request, endResponse }) {
    // A CORS preflight carries no query and costs nothing to serve. Counting it
    // would halve a browser client's real budget (preflight + POST), and a 429
    // answered to an OPTIONS has no CORS headers — the browser would report an
    // opaque CORS failure instead of a rate limit.
    if (request.method === 'OPTIONS') return

    const { success, retryAfter } = await graphqlLimiter.limit(
      clientIp(request.headers)
    )
    if (success) return

    endResponse(
      Response.json(
        { errors: [{ message: 'Rate limit exceeded. Retry shortly.' }] },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    )
  },
}

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/api/graphql',
  // Next.js App Router uses Web Request/Response objects by default
  fetchAPI: { Request, Response },
  plugins: [rateLimitPlugin, ...armor.protect().plugins],
})

export { yoga as GET, yoga as OPTIONS, yoga as POST }
