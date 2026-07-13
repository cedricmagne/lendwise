import { ReserveBorrowingState } from '@/lib/protocols/aave/v3/offchain/generated/graphql'

/**
 * What Aave lists — the single answer, for every caller.
 *
 * Two jobs enumerate Aave independently: the 10-minute APY collector and the
 * hourly catalogue sync. They must produce the SAME set of productIds — a pool we
 * collect but never catalogue is a row no query can read, and a pool we catalogue
 * but never collect is a permanent gap. Nothing enforced that, and the two drifted,
 * three ways:
 *
 *   products.ts        borrowingState === 'ENABLED'
 *   borrow-products.ts borrowingState !== 'DISABLED'   ← not the same predicate
 *   apy-spot.ts        (no check at all)
 *
 * The collector therefore emitted a borrow snapshot for every reserve — 196 of
 * them — while the catalogue registered the 85 that are actually borrowable. The
 * other 111 wrote ~2,600 rows a day into apy_hourly under product ids that have no
 * `products` row, invisible to every read path (they all INNER JOIN products) and
 * so never noticed. Roughly 18,500 rows a week of borrow rates for markets nobody
 * can borrow from.
 *
 * The fix is not to teach each caller the rule. It is to have ONE rule.
 */

/** The shape of a reserve this module needs — structural, so both generated query types fit. */
interface ReserveBorrowability {
  borrowInfo?: { borrowingState: ReserveBorrowingState } | null
}

/**
 * Does this reserve yield a borrow product?
 *
 * `borrowInfo: null` means the reserve has no borrow side at all. And the check is
 * an equality against ENABLED rather than an inequality against DISABLED, because
 * the enum has a THIRD value — `USER_EMODE_DISABLED_BORROW`, "the user emode
 * settings make this underlying not able to be borrowed". A `!== DISABLED` test
 * lets that through and lists a market that cannot be borrowed from. Aave does not
 * return it for our (user-less) queries today, but a predicate that is only correct
 * because of what the API happens not to send is a trap waiting on someone else.
 */
export function listsBorrow(reserve: ReserveBorrowability): boolean {
  return reserve.borrowInfo?.borrowingState === ReserveBorrowingState.Enabled
}

/**
 * Does this reserve yield a supply product?
 *
 * Every reserve does. Stated as a function anyway, so the supply side has a place
 * to live the day Aave gives it a condition — and so a reader looking for "what do
 * we list?" finds both halves of the answer in one file.
 */
export function listsSupply(): boolean {
  return true
}
