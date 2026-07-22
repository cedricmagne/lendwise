import { describe, expect, it } from 'vitest'

import {
  groupVariants,
  motionTokens,
  revealVariants,
  sliderTransition,
} from '../motion'

describe('revealVariants', () => {
  it('starts transparent and offset when motion is allowed', () => {
    expect(revealVariants(false).hidden).toEqual({
      opacity: 0,
      y: motionTokens.distance,
    })
  })

  it('collapses both states onto the end state under reduced motion', () => {
    const variants = revealVariants(true)
    expect(variants.hidden).toEqual({ opacity: 1, y: 0 })
    expect(variants.visible).toEqual({ opacity: 1, y: 0 })
  })
})

describe('groupVariants', () => {
  it('staggers children by the shared token by default', () => {
    expect(groupVariants(false).visible).toEqual({
      transition: { staggerChildren: motionTokens.stagger },
    })
  })

  it('accepts an explicit stagger', () => {
    expect(groupVariants(false, 0.15).visible).toEqual({
      transition: { staggerChildren: 0.15 },
    })
  })

  it('drops the stagger under reduced motion', () => {
    expect(groupVariants(true).visible).toEqual({
      transition: { staggerChildren: 0 },
    })
  })
})

describe('sliderTransition', () => {
  it('offsets each bar by the lead-in plus its index', () => {
    expect(sliderTransition(false, 2)).toEqual({
      duration: motionTokens.slider.duration,
      ease: motionTokens.ease,
      delay: motionTokens.slider.delay + 2 * motionTokens.slider.stagger,
    })
  })

  it('still applies the lead-in to the first bar', () => {
    expect(sliderTransition(false, 0)).toMatchObject({
      delay: motionTokens.slider.delay,
    })
  })

  it('renders instantly under reduced motion', () => {
    expect(sliderTransition(true, 2)).toEqual({ duration: 0 })
  })
})
