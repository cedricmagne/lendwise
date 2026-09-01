/**
 * Pure identity-planning logic for PostHog wallet identification.
 *
 * A single human can connect several wallets from different chain families
 * (an EVM address and a Stellar address, for instance). PostHog keys a person
 * by `distinct_id`, so without extra work every wallet becomes its own person
 * and cross-wallet questions ("how many users touch more than one chain?")
 * are unanswerable.
 *
 * Strategy: the first wallet connected on a device becomes the canonical
 * `distinct_id`. Every subsequent wallet is aliased onto that person, so a
 * lookup by any of the user's addresses — including from another device that
 * later connects one of the already-linked wallets — resolves to the same
 * PostHog person.
 *
 * This module is deliberately free of I/O so the decision can be unit-tested.
 * `identifyWallet` wraps it with the actual `localStorage` and `posthog` calls.
 */

export type ChainFamily = 'evm' | 'stellar'

export interface StoredWalletIdentity {
  /** The `distinct_id` every wallet of this user is merged into. */
  canonicalDistinctId: string
  /** Lower-cased addresses already linked to the canonical person. */
  linkedWallets: string[]
  /** Distinct chain families this user has connected, in first-seen order. */
  chainFamilies: ChainFamily[]
}

export interface PlanWalletIdentityInput {
  /** Persisted identity for this device, or `null` on first ever connect. */
  stored: StoredWalletIdentity | null
  /** `posthog.get_distinct_id()` at call time, or `null` when unavailable. */
  currentDistinctId: string | null
  /** Lower-cased wallet address being connected. */
  wallet: string
  chainFamily: ChainFamily
  ensName?: string | null
}

export interface WalletIdentityPlan {
  /** Identity to persist back to `localStorage`. */
  next: StoredWalletIdentity
  /**
   * When set, call `posthog.identify(distinctId, personProperties,
   * personPropertiesSetOnce)`. Mutually exclusive with `updatePropertiesOnly`.
   */
  identifyAs: string | null
  /**
   * When true, the session is already identified as the canonical person, so
   * call `posthog.setPersonProperties(personProperties,
   * personPropertiesSetOnce)` instead of re-emitting `$identify`.
   */
  updatePropertiesOnly: boolean
  /** When set, call `posthog.alias(aliasWallet, next.canonicalDistinctId)`. */
  aliasWallet: string | null
  personProperties: Record<string, unknown>
  personPropertiesSetOnce: Record<string, unknown>
}

export function planWalletIdentity({
  stored,
  currentDistinctId,
  wallet,
  chainFamily,
  ensName,
}: PlanWalletIdentityInput): WalletIdentityPlan {
  const canonicalDistinctId = stored?.canonicalDistinctId ?? wallet

  const isNewWallet = !(stored?.linkedWallets ?? []).includes(wallet)

  const linkedWallets = isNewWallet
    ? [...(stored?.linkedWallets ?? []), wallet]
    : (stored?.linkedWallets ?? [])

  const isNewChainFamily = !(stored?.chainFamilies ?? []).includes(chainFamily)
  const chainFamilies = isNewChainFamily
    ? [...(stored?.chainFamilies ?? []), chainFamily]
    : (stored?.chainFamilies ?? [])

  const next: StoredWalletIdentity = {
    canonicalDistinctId,
    linkedWallets,
    chainFamilies,
  }

  const personProperties: Record<string, unknown> = {
    wallet_address: wallet,
    last_chain_family: chainFamily,
    wallet_count: linkedWallets.length,
    chain_family_count: chainFamilies.length,
    chain_families_used: chainFamilies,
  }
  if (ensName) {
    personProperties.ens_name = ensName
  }

  const personPropertiesSetOnce: Record<string, unknown> = {
    initial_chain_family: chainFamily,
  }

  const alreadyCanonical = currentDistinctId === canonicalDistinctId

  return {
    next,
    identifyAs: alreadyCanonical ? null : canonicalDistinctId,
    updatePropertiesOnly: alreadyCanonical,
    aliasWallet: isNewWallet && wallet !== canonicalDistinctId ? wallet : null,
    personProperties,
    personPropertiesSetOnce,
  }
}
