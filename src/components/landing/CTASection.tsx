'use client'

import Link from 'next/link'

import posthog from 'posthog-js'

import { Reveal, RevealGroup } from '@/components/motion/reveal'
import { Button } from '@/components/ui/button'

import { LogoIcon } from '../logo-icon'

export function CTASection() {
  return (
    <section
      className="bg-brand-deep border-border/60 relative overflow-hidden border-b"
      id="docs"
      data-screen-label="CTA"
    >
      <span
        className="pointer-events-none absolute right-[-100px] bottom-[-200px] opacity-[0.18]"
        aria-hidden="true"
      >
        <LogoIcon className="h-152.5 w-200" />
      </span>
      <RevealGroup className="wrap py-30">
        <Reveal as="p" className="mono-label text-on-brand-faint">
          <span className="text-on-brand">/ 05</span> Get started
        </Reveal>
        <Reveal
          as="h2"
          className="mt-4.5 mb-4 max-w-[14ch] text-[clamp(40px,5.4vw,68px)] leading-none font-semibold tracking-[-0.04em] text-white"
        >
          Ready to optimize?
        </Reveal>
        <Reveal
          as="p"
          className="text-on-brand-muted m-0 mb-8.5 max-w-[46ch] text-base"
        >
          Stop guessing. Start making fully informed decisions across the entire
          lending market.
        </Reveal>
        <Reveal>
          <Button
            asChild
            className="text-brand-deep h-11 rounded bg-white px-5.5 text-sm font-medium hover:bg-white/90"
          >
            <Link
              href="/portfolio"
              onClick={() =>
                posthog.capture('landing_cta_clicked', {
                  location: 'cta_section',
                })
              }
            >
              Get started free
            </Link>
          </Button>
        </Reveal>
      </RevealGroup>
    </section>
  )
}
