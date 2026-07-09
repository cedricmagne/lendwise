'use client'

import Link from 'next/link'

import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher'
import { Badge } from '@/components/ui/badge'

export function Footer() {
  return (
    <footer className="border-border/50 bg-background border-t">
      <div className="flex h-10 items-center justify-end px-6">
        <div className="flex items-center gap-2">
          <Link
            href="/support"
            className="text-2xs text-muted-foreground hover:text-primary px-1 transition-colors"
          >
            Support
          </Link>
          <Badge
            variant="outline"
            className="text-2xs border-border h-7 gap-1.5 rounded-md px-2"
          >
            <Link
              href="/status"
              className="hover:text-primary transition-colors"
            >
              Status
            </Link>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </Badge>
          <ThemeSwitcher className="border-border h-7 w-7 rounded-md border hover:bg-transparent hover:text-emerald-500 dark:hover:bg-transparent" />
        </div>
      </div>
    </footer>
  )
}
