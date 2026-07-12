import { CTASection } from '@/components/landing/CTASection'
import { Features } from '@/components/landing/Features'
import { Footer } from '@/components/landing/Footer'
import { HeroSection } from '@/components/landing/HeroSection'
import { NavBar } from '@/components/landing/NavBar'
import { ProblemSection } from '@/components/landing/ProblemSection'
import { RevealObserver } from '@/components/landing/RevealObserver'
import { Ticker } from '@/components/landing/Ticker'

export default function Home() {
  return (
    <div className="bg-background text-foreground selection:bg-primary selection:text-primary-foreground min-h-screen font-sans antialiased [&_a]:no-underline">
      <RevealObserver />
      <NavBar />
      <HeroSection />
      <Ticker />
      <ProblemSection />
      <Features />
      <CTASection />
      <Footer />
    </div>
  )
}
