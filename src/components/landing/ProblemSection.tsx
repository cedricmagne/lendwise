import { Reveal, RevealGroup } from '@/components/motion/reveal'
import { cn } from '@/lib/utils'

import { Cube } from './Cube'
import { Typewriter } from './Typewriter'
import { chipRates } from './market-data'

const cols = [
  {
    h: 'Scattered data',
    p: 'Opportunities live across dozens of protocols and chains. There is no unified view of the market. Most investors never see the full picture.',
  },
  {
    h: 'Inconsistent APYs',
    p: 'Protocols report rates using different conventions, time windows and assumptions. Raw APYs are often not directly comparable.',
  },
  {
    h: 'Manual analysis',
    p: 'Investors spend hours switching between dashboards and checking market conditions before making informed decisions.',
  },
]

export function ProblemSection() {
  return (
    <section
      className="border-border/60 scroll-mt-17 border-b"
      id="problem"
      data-screen-label="Problem"
    >
      <div className="wrap py-27.5">
        <Reveal className="mb-14 max-w-160">
          <p className="mono-label">
            <span className="text-brand-bright">/ 00</span> The problem
          </p>
          <h2 className="text-foreground mt-3.5 mb-3.5 text-[clamp(32px,4vw,48px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
            Lending market is fragmented.
          </h2>
          <p className="text-muted-foreground m-0 max-w-[54ch] text-base leading-[1.6] text-pretty">
            Capital is spread across vaults, protocols and chains.
          </p>
        </Reveal>
        <RevealGroup className="mb-10 flex max-w-190 flex-wrap gap-2.5">
          {chipRates.map((c) => (
            <Reveal
              as="span"
              className="border-border bg-card text-muted-foreground inline-flex flex-none items-baseline gap-2.5 rounded border px-4 py-3 font-mono text-[13px] whitespace-nowrap"
              key={c.protocol}
            >
              <b className="text-foreground text-[15px] font-semibold">
                {c.rate}
              </b>{' '}
              {c.protocol}{' '}
              <span className="text-ink-faint text-[10.5px] tracking-[0.08em] whitespace-nowrap uppercase">
                {c.chipSub}
              </span>
            </Reveal>
          ))}
        </RevealGroup>
        <Reveal
          as="p"
          className="text-foreground mb-16 font-mono text-[clamp(20px,2.6vw,30px)]"
        >
          <Typewriter text="> which one is actually better?" />
          <span className="bg-brand-bright animate-blink inline-block h-[1.1em] w-[0.6em] align-text-bottom" />
        </Reveal>
        <RevealGroup className="border-border/60 max-desk:grid-cols-1 grid grid-cols-3 border-t">
          {cols.map((c, i) => (
            <Reveal
              className={cn(
                'pt-7 pr-7 pb-1',
                i === 0 ? 'pl-0' : 'border-border/60 border-l pl-7',
                'max-desk:border-l-0 max-desk:pl-0',
                i !== 0 && 'max-desk:border-border/60 max-desk:border-t'
              )}
              key={c.h}
            >
              <Cube dim />
              <h3 className="text-foreground mt-3.5 mb-2 text-base font-semibold tracking-[-0.02em]">
                {c.h}
              </h3>
              <p className="text-muted-foreground m-0 text-[14px] leading-[1.6]">
                {c.p}
              </p>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
