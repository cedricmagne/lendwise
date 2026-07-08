import Link from 'next/link'

import { LogoIcon } from './logo-icon'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      className={`text-foreground flex items-center text-base font-semibold ${className}`}
      href="/"
    >
      <LogoIcon className="mt-1 h-7 w-auto" />
      <span className="font-zalando text-lg">Lendwise</span>
    </Link>
  )
}
