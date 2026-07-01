'use client'

import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import posthog from 'posthog-js'

import { Button } from '@/components/ui/button'

export function CTASection() {
  return (
    <section className="relative overflow-hidden px-6 py-32">
      {/* Background glow */}
      <div className="absolute inset-0">
        <div className="bg-primary/8 absolute top-1/2 left-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]" />
        <div className="bg-accent/5 absolute top-1/2 left-1/3 h-[300px] w-[300px] rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6 }}
        className="relative z-10 mx-auto max-w-3xl text-center"
      >
        <h2 className="font-inter mb-6 text-4xl font-bold tracking-tight sm:text-6xl">
          Ready to <span className="text-primary text-glow-cyan">optimize</span>
          ?
        </h2>
        <p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed">
          Stop guessing. Start earning more with data-driven yield optimization
          across the entire DeFi ecosystem.
        </p>
        <Button
          size="lg"
          onClick={() =>
            posthog.capture('landing_cta_clicked', { location: 'cta_section' })
          }
          className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan group h-14 rounded-xl px-10 text-base font-semibold"
        >
          Get Started Free
          <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Button>
        <p className="text-muted-foreground mt-4 text-xs">
          No credit card required · Free tier available
        </p>
      </motion.div>
    </section>
  )
}
