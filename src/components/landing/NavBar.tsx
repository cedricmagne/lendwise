'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { Logo } from '../logo'

const links = [
  { label: 'Why Lendwise', href: '#problem' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'API', href: '#api' },
  { label: 'Portfolio', href: '#portfolio' },
  { label: 'Docs', href: '/docs' },
]

export function NavBar() {
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={cn(
        'fixed inset-x-0 top-0 z-60 border-b border-transparent transition-colors duration-200',
        solid && 'bg-background/90 border-border/60 backdrop-blur-md'
      )}
    >
      <div className="wrap flex h-[68px] items-center gap-9">
        <Logo />
        <div className="ml-3 hidden gap-[26px] min-[960px]:flex">
          {links.map((l) => {
            const cls =
              'text-muted-foreground hover:text-foreground text-[13.5px] font-medium transition-colors'
            return l.href.startsWith('/') ? (
              <Link key={l.label} className={cls} href={l.href}>
                {l.label}
              </Link>
            ) : (
              <Link key={l.label} className={cls} href={l.href}>
                {l.label}
              </Link>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <ThemeSwitcher />
          <Button
            asChild
            className="hover:bg-brand-bright bg-primary h-9 rounded px-4 text-[13px] font-medium text-white"
          >
            <Link href="/portfolio">Launch app</Link>
          </Button>
        </div>
      </div>
    </nav>
  )
}
