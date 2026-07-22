import type { Metadata } from 'next'

import Link from 'next/link'

import { PageHeader, Prose } from '../prose'

export const metadata: Metadata = {
  title: 'Terms of Service - Lendwise',
  description:
    'Terms of use for Lendwise: informational analytics only, no financial advice, non-custodial, data provided as-is.',
}

export default function TermsPage() {
  return (
    <>
      <PageHeader
        label="LEGAL"
        title="Terms of Service"
        updated="July 18, 2026"
      />
      <Prose>
        <p>
          By using <a href="https://lendwise.fi">lendwise.fi</a> (the
          &ldquo;Service&rdquo;), you agree to these terms. If you do not agree,
          do not use the Service.
        </p>

        <h2>What the Service is</h2>
        <p>
          Lendwise is an analytics platform. It aggregates public data from DeFi
          lending protocols, standardizes rates to a comparable net APY, and
          provides allocation suggestions. It is a read-only tool: it does not
          hold funds, execute transactions, or take custody of any asset.
        </p>

        <h2>Not financial advice</h2>
        <p>
          Nothing on the Service is investment, financial, legal, or tax advice.
          Rates, projections, and optimizer outputs are informational only. DeFi
          protocols carry real risks — smart-contract bugs, liquidations,
          depegs, governance failures — and past rates do not predict future
          returns. You are solely responsible for your decisions. Do your own
          research.
        </p>

        <h2>Data accuracy</h2>
        <p>
          Data is sourced from third-party protocol APIs, subgraphs, and
          blockchains, and is provided &ldquo;as is&rdquo; without warranty of
          any kind. Numbers can be delayed, incomplete, or wrong — upstream
          sources fail, markets move between refreshes. Always verify against
          the protocol&rsquo;s own interface before acting.
        </p>

        <h2>Your responsibilities</h2>
        <ul>
          <li>
            Use the Service lawfully and only where its use is permitted in your
            jurisdiction.
          </li>
          <li>
            Do not abuse the Service — scraping beyond published rate limits,
            attacking the infrastructure, or attempting to poison data.
          </li>
          <li>
            Keep control of your own wallet and keys. We never ask for them.
          </li>
        </ul>

        <h2>Open source</h2>
        <p>
          The Lendwise codebase is licensed under the{' '}
          <a
            href="https://github.com/lendwise-fi/lendwise/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT License
          </a>
          . These terms cover the hosted Service at lendwise.fi; the license
          covers the code.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Lendwise and its contributors
          are not liable for any loss — including loss of funds — arising from
          use of the Service, reliance on its data, or interaction with any
          third-party protocol linked from it.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms; the date above reflects the latest version.
          Continued use after a change constitutes acceptance.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{' '}
          <a href="mailto:hello@lendwise.fi">hello@lendwise.fi</a> or the{' '}
          <Link href="/contact">contact page</Link>.
        </p>
      </Prose>
    </>
  )
}
