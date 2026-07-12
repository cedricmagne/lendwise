'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useConnectModal } from '@rainbow-me/rainbowkit'

import { MobileNavSheet } from '@/components/mobile-nav-sheet'
import { Button } from '@/components/ui/button'
import { NetworkFamilySelectorDialog } from '@/components/wallet/NetworkFamilySelectorDialog'
import { useStellarWallet } from '@/contexts/StellarWalletContext'
import { cn } from '@/lib/utils'
import { useWalletStore } from '@/stores/walletStore'

import { Logo } from './logo'
import { UserMenu } from './user/UserMenu'

const navItems = [
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Supply', href: '/supply' },
  { label: 'Borrow', href: '/borrow' },
]

/** dashboard header height (h-14) — the mobile menu hangs below it */
const HEADER_H = 56

export function Navbar() {
  const { wallets } = useWalletStore()
  const isConnected = wallets.some((w) => w.isConnected && w.isActive)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [showNetworkDialog, setShowNetworkDialog] = useState(false)

  const { openConnectModal } = useConnectModal()
  const { connectStellar } = useStellarWallet()

  return (
    <header className="border-border bg-card sticky top-0 z-50 w-full border-b">
      <div className="flex h-14 items-center justify-between px-4 md:justify-start md:gap-8 md:px-6">
        <Logo />

        {/* Nav links — desktop */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 md:ml-auto">
          {isConnected ? (
            <UserMenu />
          ) : (
            <Button
              size="sm"
              onClick={() => setShowNetworkDialog(true)}
              className="hidden sm:flex"
            >
              Connect wallet
            </Button>
          )}

          {/* Burger — mobile only. Same full-width menu as the landing header:
           * drops under the bar, which stays visible and interactive. */}
          <MobileNavSheet
            open={open}
            onOpenChange={setOpen}
            offset={HEADER_H}
            triggerClassName="md:hidden"
          >
            <nav className="flex flex-col px-4 py-2">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'border-border/60 border-b py-4 text-[15px] font-medium transition-colors',
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {!isConnected && (
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    setShowNetworkDialog(true)
                  }}
                  className="mt-4 mb-2 w-full"
                >
                  Connect wallet
                </Button>
              )}
            </nav>
          </MobileNavSheet>
        </div>
      </div>

      <NetworkFamilySelectorDialog
        open={showNetworkDialog}
        onOpenChange={setShowNetworkDialog}
        onSelectEVM={() => openConnectModal?.()}
        onSelectStellar={connectStellar}
      />
    </header>
  )
}
