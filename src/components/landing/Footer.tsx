import Link from 'next/link'

import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher'

import { Logo } from '../logo'

type FooterLink = { label: string; href: string; external?: boolean }

const groups: Record<string, FooterLink[]> = {
  Product: [
    { label: 'Features', href: '/#features' },
    { label: 'Supply rates', href: '/supply' },
    { label: 'Borrow rates', href: '/borrow' },
    { label: 'Portfolio', href: '/portfolio' },
  ],
  Resources: [
    { label: 'Documentation', href: '/docs' },
    { label: 'API docs', href: '/docs/api/' },
    { label: 'Learn', href: '/docs/learn/' },
    { label: 'Status', href: '/status' },
    {
      label: 'Changelog',
      href: 'https://github.com/lendwise-fi/lendwise/releases',
      external: true,
    },
  ],
  Company: [
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
    { label: 'Support', href: '/support' },
    {
      label: 'GitHub',
      href: 'https://github.com/lendwise-fi/lendwise',
      external: true,
    },
  ],
}

const legalLinks: FooterLink[] = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Cookies', href: '/cookies' },
]

export function Footer() {
  return (
    <footer className="bg-background" data-screen-label="Footer">
      <div className="wrap pt-[72px] pb-10">
        <div className="border-border/60 max-desk:grid-cols-2 grid grid-cols-[2fr_1fr_1fr_1fr] gap-10 border-b pb-14">
          <div className="max-desk:col-span-2">
            <Logo className="mb-4" />
            <p className="text-ink-faint m-0 max-w-[30ch] text-[13.5px] leading-[1.6]">
              Unified view for cross-chain lending markets.
            </p>
          </div>
          {Object.entries(groups).map(([title, items]) => (
            <div key={title}>
              <h4 className="text-ink-faint m-0 mb-[14px] font-mono text-[11px] font-medium tracking-[0.12em] uppercase">
                {title}
              </h4>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {items.map((item) => (
                  <li key={item.label}>
                    {item.external ? (
                      <a
                        className="text-muted-foreground hover:text-foreground text-[13.5px] transition-colors"
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        className="text-muted-foreground hover:text-foreground text-[13.5px] transition-colors"
                        href={item.href}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {/* below `desk` the row stacks and reorders: links, switcher, then the
         * copyright last */}
        <div className="text-ink-faint max-desk:flex-col max-desk:gap-4 flex items-center gap-6 pt-6 font-mono text-[11.5px]">
          <span className="max-desk:order-3 max-desk:text-center">
            © 2026 Lendwise. All rights reserved.
          </span>
          <span className="max-desk:order-1 max-desk:ml-0 ml-auto flex gap-5">
            {legalLinks.map((l) => (
              <Link
                key={l.label}
                className="text-ink-faint hover:text-muted-foreground"
                href={l.href}
              >
                {l.label}
              </Link>
            ))}
          </span>
          <ThemeSwitcher className="border-border max-desk:order-2 h-7 w-7 rounded-md border hover:bg-transparent hover:text-emerald-500 dark:hover:bg-transparent" />
        </div>
      </div>
    </footer>
  )
}
