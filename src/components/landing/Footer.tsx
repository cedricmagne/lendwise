import Link from 'next/link'

import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher'

import { Logo } from '../logo'

const groups: Record<string, string[]> = {
  Product: ['Features', 'Pricing', 'API docs', 'Changelog'],
  Resources: ['Documentation', 'Blog', 'Tutorials', 'Status'],
  Company: ['About', 'Careers', 'Contact', 'Privacy'],
}

export function Footer() {
  return (
    <footer className="bg-background" data-screen-label="Footer">
      <div className="wrap pt-[72px] pb-10">
        <div className="border-border/60 max-desk:grid-cols-2 grid grid-cols-[2fr_1fr_1fr_1fr] gap-10 border-b pb-14">
          <div className="max-desk:col-span-2">
            <Logo className="mb-4" />
            <p className="text-ink-faint m-0 max-w-[30ch] text-[13.5px] leading-[1.6]">
              The unified yield aggregation and optimization platform for DeFi.
            </p>
          </div>
          {Object.entries(groups).map(([title, items]) => (
            <div key={title}>
              <h4 className="text-ink-faint m-0 mb-[14px] font-mono text-[11px] font-medium tracking-[0.12em] uppercase">
                {title}
              </h4>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {items.map((i) => (
                  <li key={i}>
                    <Link
                      className="text-muted-foreground hover:text-foreground text-[13.5px] transition-colors"
                      href="#"
                    >
                      {i}
                    </Link>
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
            {['Terms', 'Privacy', 'Cookies'].map((l) => (
              <Link
                key={l}
                className="text-ink-faint hover:text-muted-foreground"
                href="#"
              >
                {l}
              </Link>
            ))}
          </span>
          <ThemeSwitcher className="border-border max-desk:order-2 h-7 w-7 rounded-md border hover:bg-transparent hover:text-emerald-500 dark:hover:bg-transparent" />
        </div>
      </div>
    </footer>
  )
}
