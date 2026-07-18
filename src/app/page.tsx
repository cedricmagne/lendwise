import { CTASection } from '@/components/landing/CTASection'
import { Features } from '@/components/landing/Features'
import { Footer } from '@/components/landing/Footer'
import { HeroSection } from '@/components/landing/HeroSection'
import { NavBar } from '@/components/landing/NavBar'
import { ProblemSection } from '@/components/landing/ProblemSection'
import { RevealObserver } from '@/components/landing/RevealObserver'
import { Ticker } from '@/components/landing/Ticker'
import { catalogStatsSafe } from '@/lib/catalog-stats'
import { tickerRatesSafe } from '@/lib/ticker-rates'

export const revalidate = 3600

export default async function Home() {
  const [catalog, tickerRates] = await Promise.all([
    catalogStatsSafe(),
    tickerRatesSafe(),
  ])
  return (
    <div className="bg-background text-foreground selection:bg-primary selection:text-primary-foreground min-h-screen font-sans antialiased [&_a]:no-underline">
      <RevealObserver />
      <NavBar />
      <HeroSection marketCount={catalog?.activeProducts ?? null} />
      <Ticker rates={tickerRates} />
      <ProblemSection />
      <Features />
      <CTASection />
      <Footer />
    </div>
  )
}
