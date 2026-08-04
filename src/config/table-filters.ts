import type { TableFilter } from '@/lib/table-filters'

/**
 * The starting values of the display filters — one list per table type.
 *
 * These two numbers are the old `DISPLAY_POLICY`, and they mean something
 * different now. They used to be a verdict applied behind the user's back, with
 * hysteresis, out of a table nobody could see. They are now the position the
 * sliders start at, visible on the page and movable to zero. Same set of pools
 * on first load; a support ticket ("my pool disappeared") becomes a sentence
 * ("lower the floor").
 *
 * A LIST, not a single object: each table starts with three rows, and the set
 * has to be able to grow without the UI changing shape.
 */

/** $100k is where a market starts being one you can act on. */
export const DEFAULT_MIN_TVL_USD = 100_000

/**
 * Net APY ceiling, as a fraction — 10 is 1000 %.
 *
 * Not redundant with the floor above, and this is the part a simplification
 * must not carry away: an absurd rate is not a liquidity problem. The two pools
 * it catches hold $27.8M and $8.9M at 100 % utilisation and quote 297,996 %.
 * Real money, real IRM output, completely unactionable — and a TVL floor never
 * touches them.
 */
export const DEFAULT_MAX_ABS_NET_APY = 10

/**
 * Both bounds are written out, because the builder offers `≤` and `≥` and no
 * absolute value. Two rows is also the honest shape: on the borrow side
 * `base + fees − rewards` can go far negative, and a one-sided ceiling would
 * quietly stop catching it.
 */
const rateBounds = (): TableFilter[] => [
  { id: crypto.randomUUID(), field: 'netApy', op: 'lte', value: DEFAULT_MAX_ABS_NET_APY },
  { id: crypto.randomUUID(), field: 'netApy', op: 'gte', value: -DEFAULT_MAX_ABS_NET_APY },
]

export const DEFAULT_SUPPLY_FILTERS: TableFilter[] = [
  { id: crypto.randomUUID(), field: 'deposits', op: 'gte', value: DEFAULT_MIN_TVL_USD },
  ...rateBounds(),
]

/**
 * Identical to supply today. Kept as its own export precisely so it can stop
 * being identical without anyone touching a component.
 */
export const DEFAULT_BORROW_FILTERS: TableFilter[] = [
  { id: crypto.randomUUID(), field: 'deposits', op: 'gte', value: DEFAULT_MIN_TVL_USD },
  ...rateBounds(),
]
