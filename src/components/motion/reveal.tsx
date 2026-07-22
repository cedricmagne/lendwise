'use client'

import type { ReactNode } from 'react'
import { createContext, useContext, useRef } from 'react'

import { motion, useInView, useReducedMotion } from 'motion/react'

import {
  groupVariants,
  motionTokens,
  revealVariants,
  revealViewport,
} from '@/lib/motion'

type Tag = 'div' | 'p' | 'span' | 'section' | 'ul' | 'li' | 'h1' | 'h2' | 'h3'

/**
 * The element map keeps `as` to a closed set. Headings are included so a
 * revealed heading stays a heading — wrapping one in a motion div would change
 * the document outline. The cast pins the props to the div variant: a union of
 * nine motion components makes JSX prop-checking blow up, and every tag here
 * takes the same props we pass.
 */
const TAGS = {
  div: motion.div,
  p: motion.p,
  span: motion.span,
  section: motion.section,
  ul: motion.ul,
  li: motion.li,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
} as const

const resolveTag = (as: Tag) => TAGS[as] as typeof motion.div

/** null = no provider above; boolean = revealed state of the nearest one. */
const RevealContext = createContext<boolean | null>(null)

/**
 * True once the surrounding <Reveal> or <RevealGroup> has entered the viewport.
 * Imperative effects (typewriter, counters) gate on this so they start with
 * their section's fade instead of at mount — the bug this whole system exists
 * to fix. Returns true when there is no provider, so a component used on its
 * own still runs rather than silently never starting.
 */
export function useRevealed(): boolean {
  return useContext(RevealContext) ?? true
}

type CommonProps = {
  as?: Tag
  className?: string
  id?: string
  children?: ReactNode
}

/**
 * One element that fades in. Standalone it observes its own viewport entry;
 * inside a <RevealGroup> it drops its trigger and inherits the parent's
 * animation state through motion's variant propagation.
 */
export function Reveal({ as = 'div', className, id, children }: CommonProps) {
  const reduced = useReducedMotion() ?? false
  const inherited = useContext(RevealContext)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, revealViewport)
  const Component = resolveTag(as)
  const active = inherited ?? (reduced || inView)

  const element = (
    <Component
      ref={ref}
      id={id}
      className={className}
      data-reveal=""
      variants={revealVariants(reduced)}
      {...(inherited === null
        ? { initial: 'hidden', animate: active ? 'visible' : 'hidden' }
        : {})}
    >
      {children}
    </Component>
  )

  // Inside a group the parent already provides the context and drives the
  // animation; re-providing here would shadow it with the same value.
  if (inherited !== null) return element

  return (
    <RevealContext.Provider value={active}>{element}</RevealContext.Provider>
  )
}

/**
 * Orchestrator. Renders no visual of its own — it only staggers its <Reveal>
 * children and publishes the context. `trigger="mount"` is for above-the-fold
 * content, where "entered the viewport" is meaningless.
 */
export function RevealGroup({
  as = 'div',
  className,
  id,
  trigger = 'viewport',
  stagger = motionTokens.stagger,
  children,
}: CommonProps & { trigger?: 'viewport' | 'mount'; stagger?: number }) {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, revealViewport)
  const Component = resolveTag(as)
  const active = trigger === 'mount' || reduced ? true : inView

  return (
    <RevealContext.Provider value={active}>
      <Component
        ref={ref}
        id={id}
        className={className}
        initial="hidden"
        animate={active ? 'visible' : 'hidden'}
        variants={groupVariants(reduced, stagger)}
      >
        {children}
      </Component>
    </RevealContext.Provider>
  )
}
