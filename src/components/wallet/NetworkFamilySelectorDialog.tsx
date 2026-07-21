'use client'

import * as React from 'react'

import Image from 'next/image'

import { Activity, ArrowRight, Globe } from 'lucide-react'
import { motion } from 'motion/react'
import posthog from 'posthog-js'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface NetworkFamilySelectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectEVM: () => void
  onSelectStellar: () => void
}

export function NetworkFamilySelectorDialog({
  open,
  onOpenChange,
  onSelectEVM,
  onSelectStellar,
}: NetworkFamilySelectorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card/95 border-border overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-xl sm:max-w-120">
        {/* Glow Effects */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="bg-primary/10 absolute top-[-40%] left-[-20%] h-62.5 w-62.5 rounded-full blur-3xl" />
          <div className="absolute right-[-20%] bottom-[-40%] h-62.5 w-62.5 rounded-full bg-indigo-500/10 blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col gap-6 p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="font-outfit from-foreground to-foreground/80 bg-linear-to-r bg-clip-text text-2xl font-bold text-transparent">
              Choose Network Family
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/90 mt-1 text-sm">
              Select the ecosystem you want to connect to. You can bridge or
              manage your yields across chains.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* EVM Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                posthog.capture('wallet_connected', { network_family: 'evm' })
                onOpenChange(false)
                onSelectEVM()
              }}
              className="group border-border/80 bg-card hover:border-primary/40 hover:bg-primary/5 relative flex cursor-pointer items-center justify-between rounded-2xl border p-5 text-left shadow-xs transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="border-primary/20 bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-xl border transition-transform group-hover:scale-110">
                  <Image
                    src="/icons/network/ethereum.svg"
                    alt="Ethereum"
                    width={28}
                    height={28}
                    className="h-7 w-7"
                  />
                </div>
                <div>
                  <h4 className="text-foreground text-base font-semibold">
                    EVM Chains
                  </h4>
                  <p className="text-muted-foreground mt-1 max-w-65 text-xs">
                    Ethereum, Arbitrum, Base, Optimism, Polygon, and more.
                  </p>
                </div>
              </div>
              <ArrowRight className="text-muted-foreground group-hover:text-primary h-5 w-5 transition-all group-hover:translate-x-1" />
            </motion.button>

            {/* Stellar Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                posthog.capture('wallet_connected', {
                  network_family: 'stellar',
                })
                onOpenChange(false)
                onSelectStellar()
              }}
              className="group border-border/80 bg-card relative flex cursor-pointer items-center justify-between rounded-2xl border p-5 text-left shadow-xs transition-all hover:border-indigo-500/40 hover:bg-indigo-500/5"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-500 transition-transform group-hover:scale-110">
                  <Image
                    src="/icons/network/stellar.svg"
                    alt="Stellar"
                    width={28}
                    height={28}
                    className="h-7 w-7 dark:invert"
                  />
                </div>
                <div>
                  <h4 className="text-foreground text-base font-semibold">
                    Stellar Network
                  </h4>
                  <p className="text-muted-foreground mt-1 max-w-65 text-xs">
                    Access Blend protocol.
                  </p>
                </div>
              </div>
              <ArrowRight className="text-muted-foreground h-5 w-5 transition-all group-hover:translate-x-1 group-hover:text-indigo-500" />
            </motion.button>
          </div>

          <div className="border-border/40 text-muted-foreground/80 flex items-center justify-between border-t pt-4 text-[10px] tracking-wide uppercase">
            <div className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              <span>Multi-Chain yield optimizer</span>
            </div>
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>Secure connection</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
