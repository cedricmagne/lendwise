import Link from 'next/link'

import { Reveal, RevealGroup } from '@/components/motion/reveal'
import { Button } from '@/components/ui/button'
import { TX_CHAIN_COUNT } from '@/config/chains'
import { STANDARDIZED_CHAIN_COUNT } from '@/config/chains-coverage'
import { cn } from '@/lib/utils'

import { CountUp } from './CountUp'
import { Cube } from './Cube'
import { CubeField } from './CubeField'

const lineSoft = 'oklch(from var(--border) l c h / 0.6)'

export function HeroSection({ marketCount }: { marketCount: number | null }) {
  const stats = [
    {
      value: STANDARDIZED_CHAIN_COUNT,
      suffix: '',
      label: 'Chains standardized',
    },
    { value: TX_CHAIN_COUNT, suffix: '', label: 'Chains with execution' },
    {
      value: marketCount ?? 700,
      suffix: marketCount != null ? '' : '+',
      label: 'Lending markets',
    },
    { value: 60, suffix: 's', label: 'Data refresh' },
  ]
  return (
    <header
      className="border-border/60 relative flex min-h-screen flex-col overflow-hidden border-b"
      data-screen-label="Hero"
    >
      <div className="relative flex flex-1 items-center overflow-hidden pt-28 pb-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage: `linear-gradient(${lineSoft} 1px, transparent 1px), linear-gradient(90deg, ${lineSoft} 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
            maskImage:
              'radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 70%)',
          }}
        />
        <CubeField />
        <div className="wrap w-full">
          <RevealGroup
            trigger="mount"
            className="desk:pl-22 relative z-2 max-w-180"
          >
            <Reveal as="p" className="mono-label mb-6.5">
              <Cube /> DEFI LENDING AGGREGATOR
            </Reveal>
            <Reveal
              as="h1"
              className="text-foreground m-0 mb-6 flex flex-col text-7xl leading-18 font-semibold text-balance"
            >
              Unified view for lending markets.{' '}
              <span className="from-brand-bright to-brand-deep bg-linear-to-r bg-clip-text text-transparent">
                One standard.
              </span>
            </Reveal>
            <Reveal
              as="p"
              className="text-muted-foreground mb-9 max-w-[44ch] text-[17px] leading-[1.6] text-pretty"
            >
              Track, compare and analyze lending markets across protocols and
              chains. Transform fragmented APY data into actionable market
              insights and smart decisions.
            </Reveal>
            <Reveal className="max-xs:flex-col max-xs:items-stretch flex items-center gap-3">
              <Button
                asChild
                className="hover:bg-brand-bright active:bg-brand-deep bg-primary text-primary-foreground h-11 rounded px-5.5 text-sm font-medium"
              >
                <Link href="/supply">Explore yields</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-border text-foreground hover:border-muted-foreground hover:text-foreground h-11 rounded bg-transparent px-5.5 text-sm font-medium hover:bg-transparent"
              >
                <Link href="/docs">Read the docs</Link>
              </Button>
            </Reveal>
          </RevealGroup>
        </div>
      </div>
      <div className="bg-background border-border/60 relative z-2 border-t">
        <RevealGroup className="desk:grid-cols-4 wrap grid grid-cols-2">
          {stats.map((s, i) => (
            <Reveal
              className={cn(
                'desk:border-t-0 py-5.5',
                i % 2 === 0 ? 'pl-0' : 'border-border/60 border-l pl-6',
                i >= 2 && 'border-border/60 border-t',
                i === 0
                  ? 'desk:pl-0'
                  : 'desk:border-border/60 desk:border-l desk:pl-6'
              )}
              key={s.label}
            >
              <b className="text-foreground block font-mono text-[26px] font-semibold tracking-[-0.02em]">
                <CountUp suffix={s.suffix} value={s.value} />
              </b>
              <span className="text-ink-faint text-[12.5px]">{s.label}</span>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </header>
  )
}
