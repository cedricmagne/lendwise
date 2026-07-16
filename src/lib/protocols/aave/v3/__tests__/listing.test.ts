import { describe, expect, it } from 'vitest'

import { ReserveBorrowingState } from '@/lib/protocols/aave/v3/generated/graphql'
import { listsBorrow } from '@/lib/protocols/aave/v3/listing'

describe('listsBorrow', () => {
  it('lists a reserve whose borrowing is enabled', () => {
    expect(
      listsBorrow({
        borrowInfo: { borrowingState: ReserveBorrowingState.Enabled },
      })
    ).toBe(true)
  })

  it('does not list a reserve whose borrowing is disabled', () => {
    // 90 of Aave's 196 reserves. The collector used to emit a borrow snapshot for
    // every one of them, under product ids the catalogue never creates.
    expect(
      listsBorrow({
        borrowInfo: { borrowingState: ReserveBorrowingState.Disabled },
      })
    ).toBe(false)
  })

  it('does not list a reserve with no borrow side at all', () => {
    // 21 more. `borrowInfo: null` is not "borrowing is enabled".
    expect(listsBorrow({ borrowInfo: null })).toBe(false)
    expect(listsBorrow({})).toBe(false)
  })

  it('does not list an emode-blocked reserve — the case `!== DISABLED` let through', () => {
    // The reason this is an equality against ENABLED and not an inequality against
    // DISABLED. The enum has a third value, and the /borrow page's own copy of this
    // rule (`!== 'DISABLED'`) listed markets that cannot be borrowed from. Aave does
    // not return it for our user-less queries today — which is exactly what made the
    // bug invisible.
    expect(
      listsBorrow({
        borrowInfo: {
          borrowingState: ReserveBorrowingState.UserEmodeDisabledBorrow,
        },
      })
    ).toBe(false)
  })
})
