'use client'

import * as React from 'react'

import { ChevronDown, Globe } from 'lucide-react'
import type { Chain } from 'wagmi/chains'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CHAINS } from '@/config/chains'

interface BlockchainSelectorProps {
  selectedChains?: number[]
  onChainsChange?: (chains: number[]) => void
  className?: string
  showTestnets?: boolean
}

const CHAIN_LOGOS: Record<number, string> = {
  1: '🌐', // Ethereum
  42161: '🔷', // Arbitrum
  10: '🔴', // Optimism
  137: '🟣', // Polygon
  8453: '🔵', // Base
  59144: '🟢', // Linea
  42220: '🟡', // Celo
  43114: '🔺', // Avalanche
  56: '🟡', // BSC
  324: '⚫', // zkSync
  100: '🟠', // Gnosis
}

const getChainDisplayName = (chain: Chain) => {
  const name = chain.name
    .replace(' Mainnet', '')
    .replace(' Testnet', '')
    .replace(' Network', '')
  return name
}

const getChainShortName = (chain: Chain) => {
  if (chain.id === 1) return 'ETH'
  if (chain.id === 42161) return 'ARB'
  if (chain.id === 10) return 'OP'
  if (chain.id === 137) return 'MATIC'
  if (chain.id === 8453) return 'BASE'
  if (chain.id === 59144) return 'LINEA'
  if (chain.id === 42220) return 'CELO'
  if (chain.id === 43114) return 'AVAX'
  if (chain.id === 56) return 'BSC'
  if (chain.id === 324) return 'ZK'
  if (chain.id === 100) return 'GNO'
  return chain.name.slice(0, 4).toUpperCase()
}

export function BlockchainSelector({
  selectedChains = [],
  onChainsChange,
  className,
  showTestnets = true,
}: BlockchainSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const mainnets = CHAINS.MAINNETS
  const testnets = CHAINS.TESTNETS
  const availableChains = showTestnets ? [...mainnets, ...testnets] : mainnets

  const handleChainToggle = React.useCallback(
    (chainId: number, checked: boolean) => {
      if (onChainsChange) {
        if (checked) {
          onChainsChange([...selectedChains, chainId])
        } else {
          onChainsChange(selectedChains.filter((id) => id !== chainId))
        }
      }
    },
    [selectedChains, onChainsChange]
  )

  const handleSelectAll = React.useCallback(
    (checked: boolean) => {
      if (onChainsChange) {
        if (checked) {
          onChainsChange(availableChains.map((chain) => chain.id))
        } else {
          onChainsChange([])
        }
      }
    },
    [availableChains, onChainsChange]
  )

  const getSelectedChainsForDisplay = () => {
    return selectedChains.slice(0, 5) // Show only first 5 selected chains
  }

  const hasSelectedChains = selectedChains.length > 0
  const isAllSelected =
    selectedChains.length === availableChains.length &&
    availableChains.length > 0

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`min-w-50 justify-between ${className}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0" />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {hasSelectedChains ? (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    {getSelectedChainsForDisplay().map((chainId) => (
                      <span
                        key={chainId}
                        className="text-sm"
                        title={getChainDisplayName(
                          availableChains.find((c) => c.id === chainId) ??
                            ({} as Chain)
                        )}
                      >
                        {CHAIN_LOGOS[chainId] || '🔗'}
                      </span>
                    ))}
                    {selectedChains.length > 5 && (
                      <span className="text-muted-foreground text-xs">
                        +{selectedChains.length - 5}
                      </span>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-1 shrink-0">
                    {selectedChains.length}
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">Select networks</span>
              )}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="flex max-h-100 w-72 flex-col p-0"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Networks</DropdownMenuLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSelectAll(!isAllSelected)}
            className="h-6 px-2 text-xs"
          >
            {isAllSelected ? 'Deselect All' : 'Select All'}
          </Button>
        </div>

        <div className="scrollbar-thumb-border max-h-87.5 flex-1 scrollbar-thin scrollbar-track-transparent overflow-y-auto p-1">
          {/* Mainnets */}
          {mainnets.map((chain) => (
            <DropdownMenuCheckboxItem
              key={chain.id}
              checked={selectedChains.includes(chain.id)}
              onCheckedChange={(checked) =>
                handleChainToggle(chain.id, checked as boolean)
              }
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{CHAIN_LOGOS[chain.id] || '🔗'}</span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {getChainDisplayName(chain)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {getChainShortName(chain)} • {chain.id}
                  </span>
                </div>
              </div>
            </DropdownMenuCheckboxItem>
          ))}

          {showTestnets && testnets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground px-2 py-1 text-xs font-medium">
                Testnets
              </DropdownMenuLabel>

              {testnets.map((chain) => (
                <DropdownMenuCheckboxItem
                  key={chain.id}
                  checked={selectedChains.includes(chain.id)}
                  onCheckedChange={(checked) =>
                    handleChainToggle(chain.id, checked as boolean)
                  }
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {CHAIN_LOGOS[chain.id] || '🧪'}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {getChainDisplayName(chain)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {getChainShortName(chain)} • {chain.id}
                      </span>
                    </div>
                    <Badge variant="outline" className="ml-auto text-xs">
                      Testnet
                    </Badge>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
            </>
          )}
        </div>

        {selectedChains.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-1 pb-1">
              <DropdownMenuCheckboxItem
                checked={isAllSelected}
                onCheckedChange={(checked) =>
                  handleSelectAll(checked as boolean)
                }
              >
                Select All {showTestnets ? 'Networks' : 'Mainnets'}
              </DropdownMenuCheckboxItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default BlockchainSelector
