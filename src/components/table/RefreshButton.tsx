'use client'

import { useEffect, useState } from 'react'

import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatUpdatedAgo } from '@/lib/format-relative-time'

/**
 * Manual data-refresh trigger with a freshness hint. The 30 s tick only
 * re-renders the relative label — it never fetches anything.
 */
export function RefreshButton({
  onRefresh,
  isRefreshing,
  updatedAt,
}: {
  onRefresh: () => void
  isRefreshing: boolean
  /** Epoch ms of the last successful fetch (React Query `dataUpdatedAt`). */
  updatedAt: number
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh data"
          className="bg-input/50 border-border h-9 cursor-pointer border px-2 text-xs"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isRefreshing
          ? 'Refreshing…'
          : `Updated ${formatUpdatedAgo(updatedAt, now)}`}
      </TooltipContent>
    </Tooltip>
  )
}
