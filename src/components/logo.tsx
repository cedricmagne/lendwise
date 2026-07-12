import Link from 'next/link'

import { cn } from '@/lib/utils'

import { LogoIcon } from './logo-icon'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      className={cn(
        'text-foreground flex shrink-0 items-center text-base font-semibold',
        className
      )}
      href="/"
    >
      <LogoIcon className="mt-1 h-7 w-auto" />
      <span className="font-zalando text-lg">Lendwise</span>
    </Link>
  )
}
