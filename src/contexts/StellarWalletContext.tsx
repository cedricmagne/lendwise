'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

import { identifyWallet } from '@/lib/analytics/identifyWallet'
import { formatAddress } from '@/lib/utils'
import { useWalletStore } from '@/stores/walletStore'
import type { Wallet } from '@/stores/walletStore'

interface StellarWalletContextType {
  connectStellar: () => Promise<void>
  disconnectStellar: (address: string) => void
  isConnecting: boolean
  error: string | null
}

const StellarWalletContext = createContext<
  StellarWalletContextType | undefined
>(undefined)

export function StellarWalletProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const { addWallets, updateWallet, removeWallet } = useWalletStore()

  useEffect(() => {
    // Dynamically initialize the Stellar Wallets Kit on the client side
    const initKit = async () => {
      try {
        const { StellarWalletsKit, Networks } =
          await import('@creit-tech/stellar-wallets-kit')
        const { AlbedoModule } =
          await import('@creit-tech/stellar-wallets-kit/modules/albedo')
        const { FreighterModule } =
          await import('@creit-tech/stellar-wallets-kit/modules/freighter')
        const { LobstrModule } =
          await import('@creit-tech/stellar-wallets-kit/modules/lobstr')
        const { xBullModule } =
          await import('@creit-tech/stellar-wallets-kit/modules/xbull')

        StellarWalletsKit.init({
          network: Networks.PUBLIC,
          modules: [
            new AlbedoModule(),
            new FreighterModule(),
            new LobstrModule(),
            new xBullModule(),
          ],
        })
        setInitialized(true)
      } catch (err) {
        console.error('Failed to initialize StellarWalletsKit:', err)
      }
    }
    initKit()
  }, [])

  const connectStellar = async () => {
    if (!initialized) {
      setError('Stellar wallet kit is not initialized yet.')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const { StellarWalletsKit } =
        await import('@creit-tech/stellar-wallets-kit')
      const result = await StellarWalletsKit.authModal()
      const address = result?.address

      if (!address) {
        throw new Error('Failed to retrieve address from the wallet')
      }

      const newWallet: Wallet = {
        address: address,
        name: formatAddress(address),
        ens: null,
        walletType: 'Stellar Wallet',
        smartContractWalletType: null,
        isActive: true,
        isConnected: true,
        isCurrentlyConnected: true,
        chainFamily: 'stellar',
        avatarUri: '',
        roles: [],
        isUpdating: false,
      }

      addWallets([newWallet])
      identifyWallet({ address, chainFamily: 'stellar' })

      // Deselect other active wallets
      const allWallets = useWalletStore.getState().wallets
      allWallets.forEach((w) => {
        if (w.address !== address) {
          updateWallet(w.address, {
            isActive: false,
            isCurrentlyConnected: false,
          })
        }
      })
    } catch (err: unknown) {
      console.error('Failed to connect Stellar wallet:', err)
      const errMsg = err instanceof Error ? err.message : String(err)
      setError(errMsg || 'Failed to connect Stellar wallet')
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnectStellar = (address: string) => {
    removeWallet(address)
  }

  return (
    <StellarWalletContext.Provider
      value={{ connectStellar, disconnectStellar, isConnecting, error }}
    >
      {children}
    </StellarWalletContext.Provider>
  )
}

export function useStellarWallet() {
  const context = useContext(StellarWalletContext)
  if (context === undefined) {
    throw new Error(
      'useStellarWallet must be used within a StellarWalletProvider'
    )
  }
  return context
}
