import type { Metadata } from 'next'

import Link from 'next/link'

import { PageHeader, Prose } from '../prose'

export const metadata: Metadata = {
  title: 'Contact - Lendwise',
  description:
    'Get in touch with the Lendwise team — email, X, Farcaster, or GitHub.',
}

const channels = [
  {
    label: 'Email',
    value: 'hello@lendwise.fi',
    href: 'mailto:hello@lendwise.fi',
    note: 'Anything — partnerships, press, feedback. We read everything.',
  },
  {
    label: 'GitHub',
    value: 'lendwise-fi/lendwise',
    href: 'https://github.com/lendwise-fi/lendwise',
    note: 'Bug reports, feature requests and protocol integration requests.',
  },
  {
    label: 'X / Twitter',
    value: '@Lendwisefi',
    href: 'https://x.com/Lendwisefi',
    note: 'Announcements and updates.',
  },
  {
    label: 'Farcaster',
    value: 'lendwise',
    href: 'https://farcaster.xyz/lendwise',
    note: 'Same, on Farcaster.',
  },
]

export default function ContactPage() {
  return (
    <>
      <PageHeader label="COMPANY" title="Contact" />
      <Prose>
        <p>
          Product issue? The fastest path is the{' '}
          <Link href="/support">support page</Link> or a{' '}
          <a
            href="https://github.com/lendwise-fi/lendwise/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub issue
          </a>
          . For everything else:
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
              target={c.href.startsWith('mailto:') ? undefined : '_blank'}
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
