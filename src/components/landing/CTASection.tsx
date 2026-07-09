import Image from 'next/image'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

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
        <Image
          src="/lendwise-icon.svg"
          width={800}
          height={800}
          alt=""
          loading="eager"
          style={{ width: '800px', height: '800px' }}
        />
      </span>
      <div className="wrap py-[120px]">
        <p className="mono-label text-[oklch(0.8_0.05_25)]">
          <span className="text-[oklch(0.88_0.05_25)]">/ 05</span> Get started
        </p>
        <h2 className="mt-[18px] mb-4 max-w-[14ch] text-[clamp(40px,5.4vw,68px)] leading-none font-semibold tracking-[-0.04em] text-white">
          Ready to optimize?
        </h2>
        <p className="m-0 mb-[34px] max-w-[46ch] text-base text-[oklch(0.86_0.04_25)]">
          Stop guessing. Start making fully informed decisions across the entire
          lending market.
        </p>
        <Button
          asChild
          className="text-brand-deep h-11 rounded bg-white px-[22px] text-sm font-medium hover:bg-white/90"
        >
          <Link href="/portfolio">Get started free</Link>
        </Button>
      </div>
    </section>
  )
}
