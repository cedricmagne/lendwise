import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * IP-based rate limiting for the public API surface (/api/graphql, /api/optimizer).
 *
 * Fails OPEN by design: if Upstash is unconfigured (local dev, CI) or unreachable,
 * requests are allowed rather than rejected. Availability of lendwise.fi outranks
 * rate-limit enforcement — a Redis outage must not take the site down.
 */

export interface LimitResult {
  success: boolean
  /** Seconds until the caller may retry — for the `Retry-After` header. */
  retryAfter: number
}

const ALLOW: LimitResult = { success: true, retryAfter: 0 }

export interface Limiter {
  limit(key: string): Promise<LimitResult>
}

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN
const redis = url && token ? new Redis({ url, token }) : null

// Unconfigured is the expected state locally and in CI. In production it means
// the public endpoints are running with no rate limit at all — still allowed
// (availability wins), but it must not be silent.
if (!redis && process.env.NODE_ENV === 'production') {
  console.error(
    '[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN unset in production — ' +
      '/api/graphql and /api/optimizer are running UNRATELIMITED.'
  )
}

/** Always-allow limiter used when Upstash is not configured. */
const noopLimiter: Limiter = { limit: async () => ALLOW }

function createLimiter(requests: number, prefix: string): Limiter {
  if (!redis) return noopLimiter

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, '1 m'),
    prefix,
    analytics: false,
  })

  return {
    async limit(key: string): Promise<LimitResult> {
      try {
        const { success, reset } = await ratelimit.limit(key)
        return {
          success,
          retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
        }
      } catch (error) {
        // Redis unreachable — allow the request through rather than 503 the site.
        console.error('[ratelimit] Upstash unreachable, failing open:', error)
        return ALLOW
      }
    },
  }
}

/** 60 req/min/IP — the read-only GraphQL endpoint. */
export const graphqlLimiter = createLimiter(60, 'lw:gql')

/** 10 req/min/IP — fronts the CPU-bound solver, so it is the expensive path. */
export const optimizerLimiter = createLimiter(10, 'lw:opt')

/**
 * Client IP from the first hop of `x-forwarded-for`. Falls back to a shared
 * bucket when absent, which is the conservative choice: unattributable traffic
 * gets rate-limited together rather than escaping the limit entirely.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headers.get('x-real-ip') || 'unknown'
}
