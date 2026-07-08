'use client'

import { useEffect } from 'react'

import { CTASection } from '@/components/landing/CTASection'
import { Features } from '@/components/landing/Features'
import { Footer } from '@/components/landing/Footer'
import { HeroSection } from '@/components/landing/HeroSection'
import { NavBar } from '@/components/landing/NavBar'
import { ProblemSection } from '@/components/landing/ProblemSection'
import { Ticker } from '@/components/landing/Ticker'

export default function Home() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -4% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="bg-background text-foreground min-h-screen font-sans antialiased selection:bg-primary selection:text-white [&_a]:no-underline">
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
