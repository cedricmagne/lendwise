'use client'

import type { ReactNode } from 'react'

import { ChevronDown, SlidersHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

/**
 * Collapsed behind a trigger below `md`, always expanded above it.
 * Visibility is CSS-driven (content is force-mounted) so the expanded desktop
 * layout needs no client-side media query and survives SSR without a flash.
 */
export function FilterBar({
  activeCount,
  children,
}: {
  activeCount: number
  children: ReactNode
}) {
  return (
    <Collapsible className="w-full md:w-auto">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="group bg-input/50 h-9 w-full justify-between text-xs md:hidden"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeCount > 0 && (
              <Badge
                variant="secondary"
                className="h-4 rounded-sm px-1 text-[10px]"
              >
                {activeCount}
              </Badge>
            )}
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="mt-2 hidden data-[state=open]:block md:mt-0 md:block"
      >
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
