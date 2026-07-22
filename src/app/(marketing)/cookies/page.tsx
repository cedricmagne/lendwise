import type { Metadata } from 'next'

import Link from 'next/link'

import { PageHeader, Prose } from '../prose'

export const metadata: Metadata = {
  title: 'Cookie Policy - Lendwise',
  description:
    'What Lendwise stores in your browser: preferences in local storage, EU-hosted analytics, no advertising trackers.',
}

export default function CookiesPage() {
  return (
    <>
      <PageHeader label="LEGAL" title="Cookie Policy" updated="July 18, 2026" />
      <Prose>
        <p>
          Lendwise stores a small amount of data in your browser. Here is
          exactly what, and why.
        </p>

        <h2>Local storage (functional)</h2>
        <p>Required for the product to work the way you left it:</p>
        <ul>
          <li>
            <strong>Theme</strong> — your light/dark preference.
          </li>
          <li>
            <strong>Token icons</strong> — a cache of token logos so they load
            instantly instead of re-fetching.
          </li>
          <li>
            <strong>Preferences</strong> — table filters, selected currency, and
            similar UI state.
          </li>
          <li>
            <strong>Wallet connection</strong> — your wallet provider stores the
            session it needs to stay connected.
          </li>
        </ul>
        <p>None of this identifies you, and none of it leaves your browser.</p>

        <h2>Analytics</h2>
        <p>
          PostHog (hosted in the EU) sets identifiers to distinguish returning
          browsers so we can understand product usage. This data is pseudonymous
          — see the <Link href="/privacy">Privacy Policy</Link> for details.
        </p>

        <h2>What we do not use</h2>
        <ul>
          <li>No advertising cookies.</li>
          <li>No cross-site trackers.</li>
          <li>No fingerprinting.</li>
        </ul>

        <h2>Managing cookies</h2>
        <p>
          You can clear or block storage at any time in your browser settings.
          The site keeps working — you just lose saved preferences, and the
          theme resets to default.
        </p>
      </Prose>
    </>
  )
}
