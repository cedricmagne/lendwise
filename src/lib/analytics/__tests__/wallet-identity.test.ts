import { describe, expect, it } from 'vitest'

import {
  type StoredWalletIdentity,
  planWalletIdentity,
} from '@/lib/analytics/wallet-identity'

const EVM = '0xaaaa000000000000000000000000000000000001'
const EVM_2 = '0xaaaa000000000000000000000000000000000002'
const STELLAR = 'gaaa000000000000000000000000000000000000000000000000000001'

describe('planWalletIdentity', () => {
  it('makes the first wallet the canonical distinct id and identifies against it', () => {
    const plan = planWalletIdentity({
      stored: null,
      currentDistinctId: 'anon-device-id',
      wallet: EVM,
      chainFamily: 'evm',
      ensName: 'alice.eth',
    })

    expect(plan.next).toEqual({
      canonicalDistinctId: EVM,
      linkedWallets: [EVM],
      chainFamilies: ['evm'],
    })
    expect(plan.identifyAs).toBe(EVM)
    expect(plan.updatePropertiesOnly).toBe(false)
    expect(plan.aliasWallet).toBeNull()
    expect(plan.personProperties).toMatchObject({
      wallet_address: EVM,
      last_chain_family: 'evm',
      wallet_count: 1,
      chain_family_count: 1,
      chain_families_used: ['evm'],
      ens_name: 'alice.eth',
    })
    expect(plan.personPropertiesSetOnce).toEqual({
      initial_chain_family: 'evm',
    })
  })

  it('aliases a second wallet from another chain family onto the canonical person', () => {
    const stored: StoredWalletIdentity = {
      canonicalDistinctId: EVM,
      linkedWallets: [EVM],
      chainFamilies: ['evm'],
    }

    const plan = planWalletIdentity({
      stored,
      currentDistinctId: EVM,
      wallet: STELLAR,
      chainFamily: 'stellar',
    })

    expect(plan.next).toEqual({
      canonicalDistinctId: EVM,
      linkedWallets: [EVM, STELLAR],
      chainFamilies: ['evm', 'stellar'],
    })
    expect(plan.identifyAs).toBeNull()
    expect(plan.updatePropertiesOnly).toBe(true)
    expect(plan.aliasWallet).toBe(STELLAR)
    expect(plan.personProperties).toMatchObject({
      last_chain_family: 'stellar',
      wallet_count: 2,
      chain_family_count: 2,
      chain_families_used: ['evm', 'stellar'],
    })
  })

  it('re-identifies against the canonical id when a new session reconnects a known wallet', () => {
    const stored: StoredWalletIdentity = {
      canonicalDistinctId: EVM,
      linkedWallets: [EVM, STELLAR],
      chainFamilies: ['evm', 'stellar'],
    }

    const plan = planWalletIdentity({
      stored,
      currentDistinctId: null,
      wallet: STELLAR,
      chainFamily: 'stellar',
    })

    expect(plan.identifyAs).toBe(EVM)
    expect(plan.updatePropertiesOnly).toBe(false)
    expect(plan.aliasWallet).toBeNull()
  })

  it('does not re-alias or duplicate entries when a linked wallet reconnects mid-session', () => {
    const stored: StoredWalletIdentity = {
      canonicalDistinctId: EVM,
      linkedWallets: [EVM, EVM_2],
      chainFamilies: ['evm'],
    }

    const plan = planWalletIdentity({
      stored,
      currentDistinctId: EVM,
      wallet: EVM_2,
      chainFamily: 'evm',
    })

    expect(plan.next).toEqual(stored)
    expect(plan.identifyAs).toBeNull()
    expect(plan.updatePropertiesOnly).toBe(true)
    expect(plan.aliasWallet).toBeNull()
    expect(plan.personProperties).toMatchObject({
      wallet_count: 2,
      chain_family_count: 1,
    })
  })

  it('adds a second EVM wallet to the link list without adding a duplicate chain family', () => {
    const stored: StoredWalletIdentity = {
      canonicalDistinctId: EVM,
      linkedWallets: [EVM],
      chainFamilies: ['evm'],
    }

    const plan = planWalletIdentity({
      stored,
      currentDistinctId: EVM,
      wallet: EVM_2,
      chainFamily: 'evm',
    })

    expect(plan.next.linkedWallets).toEqual([EVM, EVM_2])
    expect(plan.next.chainFamilies).toEqual(['evm'])
    expect(plan.aliasWallet).toBe(EVM_2)
    expect(plan.personProperties).toMatchObject({
      wallet_count: 2,
      chain_family_count: 1,
    })
  })

  it('keeps initial_chain_family pointing at the connecting wallet for set_once semantics', () => {
    const stored: StoredWalletIdentity = {
      canonicalDistinctId: EVM,
      linkedWallets: [EVM],
      chainFamilies: ['evm'],
    }

    const plan = planWalletIdentity({
      stored,
      currentDistinctId: EVM,
      wallet: STELLAR,
      chainFamily: 'stellar',
    })

    // set_once means PostHog ignores this once the person already has the
    // property, so passing the current family every time is safe.
    expect(plan.personPropertiesSetOnce).toEqual({
      initial_chain_family: 'stellar',
    })
  })
})
