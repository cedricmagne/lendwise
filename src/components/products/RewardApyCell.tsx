'use client'

import { Gift } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatApy } from '@/lib/product-stats'

/**
 * The APY column's cell, shared by /supply and /borrow: the rate, plus a
 * Gift icon + tooltip when the row's rate includes a reward component.
 *
 * The two tables mean opposite things by "includes rewards" — on supply the
 * reward ADDS to the yield, on borrow it SUBTRACTS from the cost — hence
 * `rewardsLabel` rather than a hardcoded string.
 */
export function RewardApyCell({
  apy,
  rewards,
  rewardsLabel,
}: {
  apy: number | undefined
  rewards: number | undefined
  rewardsLabel: (pct: string) => string
}) {
  const hasRewards = rewards !== undefined && rewards > 0
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono">{formatApy(apy)}</span>
      <span className="inline-flex w-3.5 shrink-0 items-center">
        {hasRewards && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Gift className="h-3.5 w-3.5 text-emerald-400" />
            </TooltipTrigger>
            <TooltipContent>
              {rewardsLabel((rewards * 100).toFixed(2))}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  )
}
