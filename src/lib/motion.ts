import type { Transition, Variants } from 'motion/react'

/**
 * Single source of the landing page's motion language. The values are carried
 * over from the CSS these variants replace, so the migration is visually
 * neutral: 650ms / ease-out / translateY(22px). Stagger is new.
 */
export const motionTokens = {
  duration: 0.65,
  ease: [0, 0, 0.58, 1],
  distance: 22,
  stagger: 0.08,
  /**
   * Allocation bars in the Features optimizer panel. Slower than the 0.8s of
   * the `slide-in` keyframes this replaced, with a short lead-in: the bars sit
   * low in a tall row, and at the original speed they were finished before the
   * panel had finished scrolling into view.
   */
  slider: { duration: 1, stagger: 0.14, delay: 0.15 },
  /** CountUp animation length, in seconds — passed to motion's `animate()`. */
  countUp: 1.2,
  /**
   * Typewriter cadence, in **milliseconds** per character — passed to
   * `setInterval`, not motion's `animate()`. Every other value in this file
   * is in seconds; this one is not.
   */
  typewriterSpeed: 50,
} as const

const transition: Transition = {
  duration: motionTokens.duration,
  ease: motionTokens.ease,
}

/**
 * Variants for one element that fades in. `reducedMotion` collapses both states
 * onto the end state, so the element renders statically instead of animating
 * faster.
 *
 * The hero <h1> is the LCP element and fades like everything else. `opacity: 0`
 * does delay LCP — the browser does not count an invisible element — but only
 * until the first frame where opacity is non-zero, which the stagger puts about
 * 80ms in. Measured at 0.43s locally, against a 2.5s budget.
 */
export function revealVariants(reducedMotion: boolean): Variants {
  if (reducedMotion) {
    return { hidden: { opacity: 1, y: 0 }, visible: { opacity: 1, y: 0 } }
  }
  return {
    hidden: { opacity: 0, y: motionTokens.distance },
    visible: { opacity: 1, y: 0, transition },
  }
}

/** Container variants: no visual of their own, they only stagger children. */
export function groupVariants(
  reducedMotion: boolean,
  stagger: number = motionTokens.stagger
): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: reducedMotion ? 0 : stagger } },
  }
}

/**
 * Growth of one allocation bar: a lead-in, then each bar staggered behind the
 * one above it. Reduced motion gets the end state with no animation.
 */
export function sliderTransition(
  reducedMotion: boolean,
  index: number
): Transition {
  if (reducedMotion) return { duration: 0 }
  return {
    duration: motionTokens.slider.duration,
    ease: motionTokens.ease,
    delay: motionTokens.slider.delay + index * motionTokens.slider.stagger,
  }
}

/**
 * Same thresholds as the IntersectionObserver this replaces
 * (RevealObserver: threshold 0.05, rootMargin '0px 0px -4% 0px').
 */
export const revealViewport = {
  once: true,
  amount: 0.05,
  margin: '0px 0px -4% 0px',
} as const
