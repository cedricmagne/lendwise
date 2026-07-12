import { demoRates } from './market-data'

export function Ticker() {
  // rendered twice for a seamless -50% marquee loop
  const loop = [...demoRates, ...demoRates]
  return (
    <div
      className="bg-background border-border/60 group overflow-hidden border-b"
      aria-hidden="true"
    >
      <div className="animate-marquee flex w-max group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((tk, i) => (
          <span
            className="border-border/60 text-muted-foreground inline-flex items-center gap-3 border-r px-7 py-[14px] font-mono text-[12.5px] whitespace-nowrap"
            key={`${tk.protocol}-${i}`}
          >
            {tk.protocol.toUpperCase()} · {tk.chain}{' '}
            <b className="text-foreground font-semibold">{tk.rate}</b>{' '}
            <span className="text-rose">{tk.tickerTag}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
