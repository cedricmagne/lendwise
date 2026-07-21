'use client'

import * as React from 'react'

import { ChevronDown, Wallet } from 'lucide-react'
import { Address } from 'viem'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WalletAvatar } from '@/components/wallet'
import { formatAddress } from '@/lib/utils'
import { type Wallet as WalletType, useWalletStore } from '@/stores/walletStore'

interface WalletSelectorProps {
  selectedWallets?: Address[]
  onWalletsChange?: (wallets: Address[]) => void
  className?: string
}

export function WalletSelector({
  selectedWallets = [],
  onWalletsChange,
  className,
}: WalletSelectorProps) {
  const [open, setOpen] = React.useState(false)
  const { wallets } = useWalletStore()

  // Filter to only show connected wallets
  const connectedWallets = wallets.filter((wallet) => wallet.isConnected)

  const handleWalletToggle = React.useCallback(
    (walletAddress: Address, checked: boolean) => {
      if (onWalletsChange) {
        if (checked) {
          onWalletsChange([...selectedWallets, walletAddress])
        } else {
          onWalletsChange(
            selectedWallets.filter((addr) => addr !== walletAddress)
          )
        }
      }
    },
    [selectedWallets, onWalletsChange]
  )

  const handleSelectAll = React.useCallback(
    (checked: boolean) => {
      if (onWalletsChange) {
        if (checked) {
          onWalletsChange(connectedWallets.map((w) => w.address as Address))
        } else {
          onWalletsChange([])
        }
      }
    },
    [connectedWallets, onWalletsChange]
  )

  const getWalletDisplayName = (wallet: WalletType) => {
    if (wallet.ens) {
      return wallet.ens
    }
    return wallet.name || formatAddress(wallet.address)
  }

  const getSelectedWalletsForDisplay = () => {
    return selectedWallets.slice(0, 5) // Show only first 5 selected wallets
  }

  const hasSelectedWallets = selectedWallets.length > 0
  const isAllSelected =
    selectedWallets.length === connectedWallets.length &&
    connectedWallets.length > 0

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`min-w-50 justify-between ${className}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0" />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {hasSelectedWallets ? (
                <>
                  <div className="mr-2 flex min-w-0 flex-1 items-center gap-1">
                    {getSelectedWalletsForDisplay().map((walletAddress) => {
                      const wallet = connectedWallets.find(
                        (w) => w.address === walletAddress
                      )
                      return (
                        <span
                          key={walletAddress}
                          className="-mr-3 text-sm"
                          title={
                            wallet
                              ? getWalletDisplayName(wallet)
                              : formatAddress(walletAddress)
                          }
                        >
                          <WalletAvatar address={walletAddress} size={24} />
                        </span>
                      )
                    })}
                    {selectedWallets.length > 5 && (
                      <span className="text-muted-foreground text-xs">
                        +{selectedWallets.length - 5}
                      </span>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-1 shrink-0">
                    {selectedWallets.length} accounts
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">Select wallets</span>
              )}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="flex max-h-100 w-64 flex-col p-0"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <DropdownMenuLabel className="p-0">
            Connected Wallets
          </DropdownMenuLabel>
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
          {connectedWallets.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No wallets connected
            </div>
          ) : (
            connectedWallets.map((wallet) => (
              <DropdownMenuCheckboxItem
                key={wallet.address}
                checked={selectedWallets.includes(wallet.address as Address)}
                onCheckedChange={(checked) =>
                  handleWalletToggle(
                    wallet.address as Address,
                    checked as boolean
                  )
                }
              >
                <div className="flex items-center gap-2">
                  <WalletAvatar address={wallet.address} size={24} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {getWalletDisplayName(wallet)}
                    </span>
                  </div>
                  {wallet.isActive && (
                    <Badge variant="outline" className="ml-auto text-xs">
                      Active
                    </Badge>
                  )}
                </div>
              </DropdownMenuCheckboxItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
