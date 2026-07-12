'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { FarcasterIcon, XIcon } from '@/components/icons/social'
import { MobileNavSheet, SHEET_EXIT_MS } from '@/components/mobile-nav-sheet'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'

import { Logo } from '../logo'

/** landing header height — the mobile menu hangs below it */
const HEADER_H = 68

const links = [
  { label: 'Why Lendwise', href: '#problem' },
  { label: 'How it works', href: '#features' },
  { label: 'API', href: '#api' },
  { label: 'Portfolio', href: '#portfolio' },
  { label: 'Docs', href: '/docs' },
]

// mirrors the dashboard nav in src/components/navbar.tsx
const appLinks = [
  {
    label: 'Portfolio',
    href: '/portfolio',
    desc: 'Track lending positions and PnL across wallets.',
  },
  {
    label: 'Supply',
    href: '/supply',
    desc: 'Compare standardized supply yields across markets.',
  },
  {
    label: 'Borrow',
    href: '/borrow',
    desc: 'Find the cheapest borrow rates and collaterals.',
  },
]

const socials = [
  { label: 'X', href: 'https://x.com/lendwisefi', Icon: XIcon },
  {
    label: 'Farcaster',
    href: 'https://farcaster.xyz/lendwise',
    Icon: FarcasterIcon,
  },
]

export function NavBar() {
  const [solid, setSolid] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // stays true while the sheet is open *and* while it slides back up, so the
  // bar keeps an opaque background: otherwise it turns transparent the instant
  // the menu closes and the exiting panel is visible scrolling through it
  const [menuVisible, setMenuVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (menuOpen) {
      setMenuVisible(true)
      return
    }
    const t = window.setTimeout(() => setMenuVisible(false), SHEET_EXIT_MS)
    return () => window.clearTimeout(t)
  }, [menuOpen])

  return (
    <nav
      className={cn(
        // above the menu layer (z-40): it opens *under* the bar, which stays
        // visible and interactive over it
        'fixed inset-x-0 top-0 z-60 border-b border-transparent transition-colors duration-200',
        solid && 'bg-background/90 border-border/60 backdrop-blur-md',
        // fully opaque (not /90) while the menu is on screen or exiting —
        // the panel slides up behind the bar and must not show through
        menuVisible && 'bg-background border-border/60'
      )}
    >
      {/* tight gap below `desk` — at 320px the wide row pushes the burger
       * off-screen otherwise */}
      <div className="desk:gap-9 wrap flex h-[68px] items-center gap-3">
        <Logo />
        <div className="desk:flex ml-3 hidden gap-[26px]">
          {links.map((l) => (
            <Link
              key={l.label}
              className="text-muted-foreground hover:text-foreground text-[13.5px] font-medium transition-colors"
              href={l.href}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <NavigationMenu viewport={false}>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="hover:bg-brand-bright focus:bg-brand-bright bg-primary text-primary-foreground data-[state=open]:bg-primary data-[state=open]:text-primary-foreground data-[state=open]:hover:bg-brand-bright data-[state=open]:focus:bg-brand-bright desk:px-4 h-9 rounded px-3 text-[13px] font-medium">
                  Launch app
                </NavigationMenuTrigger>
                {/* shadcn only makes the content `absolute` from md: up — below
                 * that it lays out in flow and spills past the right edge, so
                 * anchor it to the trigger at every width */}
                <NavigationMenuContent className="absolute right-0 left-auto z-50 w-auto">
                  <ul className="w-[min(260px,calc(100vw-2.5rem))] p-2">
                    {appLinks.map((a) => (
                      <li key={a.href}>
                        <NavigationMenuLink asChild>
                          <Link href={a.href}>
                            <div className="text-[13.5px] font-medium">
                              {a.label}
                            </div>
                            <p className="text-muted-foreground text-[12.5px] leading-snug">
                              {a.desc}
                            </p>
                          </Link>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          {/* below `desk` the bar has no room for these — they move into the
           * sheet, otherwise the burger gets pushed off-screen */}
          <div className="desk:flex hidden items-center gap-1">
            {socials.map(({ label, href, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={label}
                className="text-muted-foreground hover:text-foreground hover:bg-accent grid h-9 w-9 place-items-center rounded transition-colors"
              >
                <Icon className="h-[17px] w-[17px]" />
              </a>
            ))}
          </div>

          {/* the logo and the "Launch app" links stay visible in the bar
           * above the menu, so they aren't repeated inside it */}
          <MobileNavSheet
            open={menuOpen}
            onOpenChange={setMenuOpen}
            offset={HEADER_H}
            triggerClassName="desk:hidden"
          >
            <div className="wrap flex flex-col py-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  className="text-muted-foreground hover:text-foreground border-border/60 border-b py-4 text-[15px] font-medium transition-colors"
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </Link>
              ))}
              <div className="flex items-center gap-1 pt-4 pb-2">
                {socials.map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={label}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent grid h-9 w-9 place-items-center rounded transition-colors"
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </a>
                ))}
              </div>
            </div>
          </MobileNavSheet>
        </div>
      </div>
    </nav>
  )
}
