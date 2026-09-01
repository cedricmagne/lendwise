import posthog from 'posthog-js'

import {
  type ChainFamily,
  type StoredWalletIdentity,
  planWalletIdentity,
} from '@/lib/analytics/wallet-identity'

const STORAGE_KEY = 'lendwise:ph-wallet-identity'

function readIdentity(): StoredWalletIdentity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as StoredWalletIdentity
    if (
      typeof parsed?.canonicalDistinctId !== 'string' ||
      !Array.isArray(parsed.linkedWallets) ||
      !Array.isArray(parsed.chainFamilies)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeIdentity(identity: StoredWalletIdentity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Private browsing or storage disabled — analytics linking is best-effort.
  }
}

export interface IdentifyWalletParams {
  address: string
  chainFamily: ChainFamily
  ensName?: string | null
}

/**
 * Identify a connected wallet against the user's canonical PostHog person,
 * aliasing any additional wallet so every address the same human uses — across
 * chain families and devices — rolls up to one person.
 *
 * See {@link planWalletIdentity} for the identity strategy and its limits.
 */
export function identifyWallet({
  address,
  chainFamily,
  ensName,
}: IdentifyWalletParams): void {
  if (typeof window === 'undefined' || !posthog.__loaded) {
    return
  }

  const wallet = address.toLowerCase()

  const plan = planWalletIdentity({
    stored: readIdentity(),
    currentDistinctId: posthog.get_distinct_id() ?? null,
    wallet,
    chainFamily,
    ensName,
  })

  if (plan.identifyAs) {
    posthog.identify(
      plan.identifyAs,
      plan.personProperties,
      plan.personPropertiesSetOnce
    )
  } else if (plan.updatePropertiesOnly) {
    posthog.setPersonProperties(
      plan.personProperties,
      plan.personPropertiesSetOnce
    )
  }

  if (plan.aliasWallet) {
    posthog.alias(plan.aliasWallet, plan.next.canonicalDistinctId)
  }

  writeIdentity(plan.next)
}
