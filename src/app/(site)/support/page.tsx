import type { Metadata } from 'next'

import Link from 'next/link'

import { PageHeader, Prose } from '../prose'

export const metadata: Metadata = {
  title: 'Support - Lendwise',
  description:
    'Get help with Lendwise — reach us by email, on X, or browse the documentation.',
}

const channels = [
  {
    label: 'Email',
    value: 'support@lendwise.fi',
    href: 'mailto:support@lendwise.fi',
    note: 'Questions, bug reports, or feedback — we read everything.',
  },
  {
    label: 'X / Twitter',
    value: '@Lendwisefi — DMs are open',
    href: 'https://x.com/Lendwisefi',
    note: 'Quick questions and support requests.',
  },
  {
    label: 'GitHub',
    value: 'lendwise-fi/lendwise',
    href: 'https://github.com/lendwise-fi/lendwise/issues/new/choose',
    note: 'Bug reports, feature requests and protocol integration requests.',
  },
  {
    label: 'Documentation',
    value: 'lendwise.fi/docs',
    href: '/docs',
    note: 'Guides, data methodology, and GraphQL API reference.',
  },
]

export default function SupportPage() {
  return (
    <>
      <PageHeader label="COMPANY" title="Support" />
      <Prose>
        <p>
          Email and X DMs get the fastest response — usually within 24 hours.
          For partnerships or press, head to the{' '}
          <Link href="/contact">contact page</Link>.
        </p>
      </Prose>
      <ul className="m-0 mt-8 flex list-none flex-col gap-4 p-0">
        {channels.map((c) => (
          <li
            key={c.label}
            className="border-border/60 hover:border-border rounded-xl border p-5 transition-colors"
          >
            <a
              href={c.href}
              target={
                c.href.startsWith('mailto:') || c.href.startsWith('/')
                  ? undefined
                  : '_blank'
              }
              rel="noopener noreferrer"
              className="flex flex-col gap-1"
            >
              <span className="text-ink-faint font-mono text-[11px] font-medium tracking-[0.12em] uppercase">
                {c.label}
              </span>
              <span className="text-foreground text-[15px] font-medium">
                {c.value}
              </span>
              <span className="text-muted-foreground text-[13.5px]">
                {c.note}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}
