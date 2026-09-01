'use client'

import { useEffect } from 'react'

import { getEnsName } from '@wagmi/core'
import type { Address } from 'viem'
import { useAccount, useConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'

import { useMultiWalletManager } from '@/hooks/useMultiWalletManager'
import { identifyWallet } from '@/lib/analytics/identifyWallet'
import { formatAddress } from '@/lib/utils'
import { type Wallet, useWalletStore } from '@/stores/walletStore'

/**
 * Simplified wallet watcher - just syncs wallet store with MetaMask
 * No hidden addresses, no complex state management
 */
export function WalletWatcherProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const config = useConfig()
  const { address, isConnected, chain, connector } = useAccount()
  const { addWallets, hasWallet, updateWallet, wallets } = useWalletStore()
  const { addOrUpdateClient } = useMultiWalletManager()

  // Update isActive flag when the active address changes
  useEffect(() => {
    if (!address || !isConnected) {
      return
    }

    // Update all wallets: set isActive to true for the current address, false for others
    wallets.forEach((wallet) => {
      const shouldBeActive =
        wallet.address.toLowerCase() === address.toLowerCase()
      if (wallet.isActive !== shouldBeActive) {
        updateWallet(wallet.address, {
          isActive: shouldBeActive,
          isCurrentlyConnected: shouldBeActive,
        })
      }
    })
  }, [address, isConnected, wallets, updateWallet])

  // Helper function to add a wallet
  const addWalletToStore = async (walletAddress: string, isActive = false) => {
    if (hasWallet(walletAddress)) {
      addOrUpdateClient(walletAddress as Address, chain)
      // Re-run identification for wallets restored from a previous session
      // (e.g. wagmi auto-reconnect) so a returning visitor is linked back to
      // their canonical PostHog person instead of staying anonymous.
      identifyWallet({ address: walletAddress, chainFamily: 'evm' })
      return
    }

    let ensName: string | null = null

    try {
      ensName = await Promise.race([
        getEnsName(config, {
          address: walletAddress as Address,
          chainId: mainnet.id,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
    } catch (error) {
      console.warn('[WalletWatcher] Failed to fetch ENS:', error)
    }

    const newWallet: Wallet = {
      address: walletAddress,
      name: formatAddress(walletAddress),
      ens: ensName || null,
      walletType: null,
      smartContractWalletType: null,
      isActive,
      isConnected: true,
      isCurrentlyConnected: isActive,
      chainFamily: 'evm',
      avatarUri: '',
      roles: [],
      isUpdating: false,
    }

    addWallets([newWallet])
    addOrUpdateClient(walletAddress as Address, chain)

    identifyWallet({
      address: walletAddress,
      chainFamily: 'evm',
      ensName,
    })
  }

  // Listen to accountsChanged event from MetaMask
  useEffect(() => {
    if (!isConnected || !connector) {
      return
    }

    const setupListener = async () => {
      try {
        const provider = await connector.getProvider()

        if (!provider || typeof provider !== 'object' || !('on' in provider)) {
          return
        }

        const handleAccountsChanged = async (accounts: string[]) => {
          // Add all new accounts
          for (const account of accounts) {
            const isActive = account.toLowerCase() === address?.toLowerCase()
            await addWalletToStore(account, isActive)
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(provider as any).on('accountsChanged', handleAccountsChanged)

        return () => {
          if ('removeListener' in provider) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(provider as any).removeListener(
              'accountsChanged',
              handleAccountsChanged
            )
          }
        }
      } catch (error) {
        console.error('[WalletWatcher] Failed to setup listener:', error)
      }
    }

    const cleanup = setupListener()
    return () => {
      cleanup.then((cleanupFn) => cleanupFn?.())
    }
  }, [
    isConnected,
    connector,
    address,
    chain,
    hasWallet,
    addWallets,
    addOrUpdateClient,
  ])

  // Simple sync: when connected address changes, add it to store if not exists
  useEffect(() => {
    if (!address || !isConnected) {
      return
    }

    addWalletToStore(address, true)
  }, [address, isConnected, chain, hasWallet, addWallets, addOrUpdateClient])

  return <>{children}</>
}
