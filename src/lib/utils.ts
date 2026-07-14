import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatAddress = (address: string): string => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Adapter boundary coercion for GraphQL `BigDecimal` fields.
 *
 * Codegen maps `BigDecimal` to `any`, and Aave/Compound serialize those as
 * decimal strings. Assigning one straight into a `number` field compiles, then
 * breaks anything that adds or compares instead of multiplying. Every
 * BigDecimal read in an adapter goes through here.
 */
export const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function generateSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

// Helper function to convert BigInt to string for JSON serialization
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  )
}

/**
 * Normalize a timestamp to the nearest 10-minute slot boundary (UTC).
 * The job may run at 13:17:42Z — the slot is always 13:10:00.000Z.
 * This ensures idempotent upserts regardless of job execution delay.
 */
export function normalizeSlotTimestamp(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setUTCSeconds(0, 0)
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10)
  return d
}

// ─── APR / APY conversion ─────────────────────────────────────────────────────

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60

/**
 * Per-second compounding (Aave V3, Compound V3).
 * APY = (1 + APR / seconds_per_year)^seconds_per_year - 1
 */
export function aprToApyPerSecond(apr: number): number {
  if (apr <= 0) return 0
  return Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1
}

/** @deprecated use aprToApyPerSecond */
export const aprToApyAave = aprToApyPerSecond

/**
 * Per-second compounding (inverse).
 * APR = seconds_per_year * ((1 + APY)^(1/seconds_per_year) - 1)
 */
export function apyToAprPerSecond(apy: number): number {
  if (apy <= 0) return 0
  return SECONDS_PER_YEAR * (Math.pow(1 + apy, 1 / SECONDS_PER_YEAR) - 1)
}

/** @deprecated use apyToAprPerSecond */
export const apyToAprAave = apyToAprPerSecond

/**
 * Morpho: continuous compounding.
 * APY = e^APR - 1
 *
 * @deprecated Do NOT use for reward APRs. Continuous compounding massively
 * over-inflates them (a 222% reward APR became 822% APY) because reward tokens
 * are separate assets, not auto-compounded into the position. Reward APRs are
 * now kept linear; the reward total is derived from Morpho's own net delta in
 * `apy-spot.ts`. Kept only for reference.
 */
export function aprToApyMorpho(apr: number): number {
  // `!(apr > 0)` also rejects NaN (NaN > 0 is false). e^apr overflows to
  // Infinity for a garbage APR — coerce any non-finite result to 0.
  if (!(apr > 0)) return 0
  const apy = Math.exp(apr) - 1
  return Number.isFinite(apy) ? apy : 0
}

/**
 * Morpho: continuous compounding (inverse).
 * APR = ln(1 + APY)
 */
export function apyToAprMorpho(apy: number): number {
  if (apy <= 0) return 0
  return Math.log(1 + apy)
}

/**
 * Merkl / unknown source: daily compounding (n=365).
 * APY = (1 + APR / 365)^365 - 1
 *
 * Conservative fallback when the compounding model of the source is unknown.
 * Used for Merkl campaign APRs and Merit program APRs.
 */
export function aprToApyDaily(apr: number): number {
  if (apr <= 0) return 0
  return Math.pow(1 + apr / 365, 365) - 1
}
