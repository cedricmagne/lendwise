import { useState } from 'react'

import type { Address, Hash } from 'viem'
import { parseEther } from 'viem'
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'

import { ALL_CHAINS } from '@/config/chains'

import { useWalletInfo } from './useWalletInfo'

type NetworkInfo = {
  name: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
}

type _TransactionStatus = {
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
  hash: Hash | null
}

export const useTransaction = () => {
  const [input, setInput] = useState({
    to: '',
    value: '',
  })

  const walletInfo = useWalletInfo()
  const chainId = walletInfo.chain.id
  const balance = walletInfo.balance.value

  const currentNetwork = ALL_CHAINS.find((n) => n.id === chainId) as
    NetworkInfo | undefined

  const networkConfig = currentNetwork
    ? {
        symbol: currentNetwork.nativeCurrency.symbol,
        decimals: currentNetwork.nativeCurrency.decimals,
        name: currentNetwork.name,
        minAmount: '0.00001', // Valeur par défaut, peut être personnalisée par réseau
        isTestnet: walletInfo.chain.testnet,
        isMainnet: !walletInfo.chain.testnet,
      }
    : undefined

  // Transaction sending
  const {
    sendTransactionAsync,
    data: hash,
    isPending,
    error: sendError,
  } = useSendTransaction()

  // Transaction confirmation
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash,
  })

  // Validation
  const validation = {
    address: {
      isValid: input.to?.startsWith('0x') && input.to?.length === 42,
      error:
        input.to && (!input.to?.startsWith('0x') || input.to?.length !== 42)
          ? 'Invalid address format'
          : '',
    },
    amount: {
      isValid:
        Number(input.value) > 0 && Number(input.value) <= Number(balance),
      error: input.value
        ? Number(input.value) <= 0
          ? 'Amount must be greater than 0'
          : Number(input.value) > Number(balance)
            ? 'Insufficient balance'
            : ''
        : '',
    },
    network: {
      isValid: Boolean(networkConfig),
      error: !networkConfig ? 'Unsupported network' : '',
    },
  }

  const isValid = Object.values(validation).every((v) => v.isValid)

  // Handle transaction
  const handleSend = async () => {
    if (!isValid || !networkConfig) return

    try {
      const tx = await sendTransactionAsync({
        to: input.to as Address,
        value: parseEther(input.value),
      })
      return tx
    } catch (e) {
      console.error('Transaction error:', e)
      throw e
    }
  }

  // Reset form
  const reset = () => {
    setInput({
      to: '',
      value: '',
    })
  }

  return {
    // Input state
    input,
    setInput,
    reset,

    // Network info
    networkConfig,
    chainId,
    balance,

    // Validation
    validation,
    isValid,

    // Transaction state
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    sendError,
    confirmError,

    // Actions
    handleSend,

    // Wallet info
    walletInfo,
  }
}
