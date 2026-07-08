'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
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

          {/* Burger — mobile only */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-2 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-14 items-center border-b px-6">
                <span className="text-foreground text-sm font-bold">Menu</span>
              </div>
              <nav className="flex flex-col gap-1 p-4">
                {navItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
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
              {!isConnected && (
                <div className="border-t p-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      setOpen(false)
                      setShowNetworkDialog(true)
                    }}
                    className="w-full"
                  >
                    Connect wallet
                  </Button>
                </div>
              )}
            </SheetContent>
          </Sheet>
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
