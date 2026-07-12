'use client'

import { ReactNode, useEffect, useState } from 'react'

import { createPortal } from 'react-dom'

import { Menu, X } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/** matches the sheet's data-[state=closed]:duration-300 exit animation */
export const SHEET_EXIT_MS = 300

/**
 * Full-width mobile nav menu, shared by the landing and dashboard headers.
 *
 * Drops from under the header (which stays visible and interactive on top of
 * it), dims the page below, and closes on link tap, outside press or Escape.
 * Sits at z-40 so any header above z-40 keeps covering it — and so app dialogs
 * (z-50 portals) still open over everything.
 */
export function MobileNavSheet({
  open,
  onOpenChange,
  offset,
  triggerClassName,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** header height in px — the menu hangs below it */
  offset: number
  triggerClassName?: string
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const dim = open && (
    <div
      aria-hidden="true"
      className="[pointer-events:none] fixed inset-x-0 bottom-0 z-40 bg-black/50"
      style={{ top: offset }}
    />
  )

  return (
    <>
      {/* portalled to <body>: a header with backdrop-blur would otherwise be
       * this fixed layer's containing block and collapse it to the bar */}
      {mounted && dim && createPortal(dim, document.body)}
      {/* non-modal so the header above the menu stays clickable */}
      <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
        <SheetTrigger asChild>
          <button
            type="button"
            className={cn('text-foreground -mr-1 p-1', triggerClassName)}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </SheetTrigger>
        <SheetContent
          side="top"
          className="z-40 gap-0 overflow-y-auto border-t-0 p-0 [&>button:last-child]:hidden"
          style={{ top: offset, maxHeight: `calc(100dvh - ${offset}px)` }}
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Site navigation
          </SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
    </>
  )
}
