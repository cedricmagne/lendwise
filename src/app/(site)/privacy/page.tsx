import type { Metadata } from 'next'

import Link from 'next/link'

import { PageHeader, Prose } from '../prose'

export const metadata: Metadata = {
  title: 'Privacy Policy - Lendwise',
  description:
    'How Lendwise handles data: no accounts, no data sale, pseudonymous EU-hosted analytics, wallet addresses used read-only.',
}

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        label="LEGAL"
        title="Privacy Policy"
        updated="July 18, 2026"
      />
      <Prose>
        <p>
          This policy describes what data Lendwise (&ldquo;we&rdquo;) processes
          when you use <a href="https://lendwise.fi">lendwise.fi</a>, and why.
          The short version: no accounts, no personal profiles, no selling of
          data.
        </p>

        <h2>What we collect</h2>
        <h3>Usage analytics</h3>
        <p>
          We use PostHog (hosted in the EU) to understand how the product is
          used — pages viewed, features clicked, approximate location derived
          from IP. This data is pseudonymous: it is not tied to your name or
          email, because we never ask for them.
        </p>
        <h3>Wallet addresses</h3>
        <p>
          If you connect a wallet, we use its public address to read your
          positions from public blockchains and protocol APIs. The address is
          public information by design; we do not link it to any real-world
          identity, and we do not use it for anything other than displaying your
          portfolio.
        </p>
        <h3>Server logs</h3>
        <p>
          Our hosting provider (Vercel) keeps standard technical logs — IP
          address, user agent, requested URL — for security and debugging,
          retained for a limited time.
        </p>

        <h2>What we do not do</h2>
        <ul>
          <li>We do not sell or rent any data to third parties.</li>
          <li>We do not run advertising or advertising trackers.</li>
          <li>
            We never ask for private keys, seed phrases, or custody of funds.
          </li>
          <li>We do not require an account, email, or any identity.</li>
        </ul>

        <h2>Third-party services</h2>
        <ul>
          <li>
            <strong>PostHog</strong> (EU) — product analytics.
          </li>
          <li>
            <strong>Vercel</strong> — hosting and infrastructure logs.
          </li>
          <li>
            <strong>WalletConnect / wallet providers</strong> — used only when
            you initiate a wallet connection; governed by their own policies.
          </li>
        </ul>

        <h2>Cookies and local storage</h2>
        <p>
          See the <Link href="/cookies">Cookie Policy</Link> for the full list.
        </p>

        <h2>Your rights</h2>
        <p>
          Under the GDPR and similar laws you can request access to, or deletion
          of, data we hold that relates to you. Since we hold no identity data,
          this usually concerns analytics tied to your browser. Write to{' '}
          <a href="mailto:hello@lendwise.fi">hello@lendwise.fi</a> and we will
          handle it.
        </p>

        <h2>Changes</h2>
        <p>
          We will update this page when our practices change, and adjust the
          date above. Material changes will be announced on{' '}
          <a
            href="https://x.com/Lendwisefi"
            target="_blank"
            rel="noopener noreferrer"
          >
            X
          </a>
          .
        </p>
      </Prose>
    </>
  )
}
