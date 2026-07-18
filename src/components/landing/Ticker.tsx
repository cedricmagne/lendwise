import type { TickerRate } from '@/lib/ticker-rates'

import { demoRates } from './market-data'

export function Ticker({ rates }: { rates: TickerRate[] | null }) {
  // Real rates when the DB answered; static demo strip otherwise.
  const items =
    rates ??
    demoRates.map((tk) => ({
      protocol: tk.protocol,
      chain: tk.chain,
      rate: tk.rate,
      tag: tk.tickerTag,
    }))

  // rendered twice for a seamless -50% marquee loop
  const loop = [...items, ...items]
  return (
    <div
      className="bg-background border-border/60 group overflow-hidden border-b"
      aria-hidden="true"
    >
      <div className="animate-marquee flex w-max group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((tk, i) => (
          <span
            className="border-border/60 text-muted-foreground inline-flex items-center gap-3 border-r px-7 py-[14px] font-mono text-[12.5px] whitespace-nowrap"
            key={`${tk.protocol}-${tk.chain}-${i}`}
          >
            {tk.protocol.toUpperCase()} · {tk.chain}{' '}
            <b className="text-foreground font-semibold">{tk.rate}</b>{' '}
            <span className="text-rose">{tk.tag}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
