import { describe, it, expect } from 'vitest'
import { compassNeedleTransform, zoomButtonsDisabled, northResetEase, nodePosTap } from './maprail.js'
import { NODEPOS_MODES } from './nodeposmode.js'

// #630: the rail's decisions, apart from the buttons they paint.
describe('compassNeedleTransform', () => {
  // The needle points at north on screen. A map turned to bearing 90 has east
  // up, so north is a quarter turn counter-clockwise: the needle turns against
  // the bearing, not with its sign.
  it('turns the needle against the bearing, so it keeps pointing at north', () => {
    expect(compassNeedleTransform(0)).toBe('rotate(0deg)')
    expect(compassNeedleTransform(90)).toBe('rotate(-90deg)')
    expect(compassNeedleTransform(-45)).toBe('rotate(45deg)')
  })
})

describe('zoomButtonsDisabled', () => {
  const BOUNDS = { min: 0, max: 22 }

  // A button that does nothing when pressed has to look it. At the exact bound,
  // not near it: a map one scroll tick short of max can still zoom in.
  it('disables zoom in at the max zoom and not a hair below it', () => {
    expect(zoomButtonsDisabled(22, BOUNDS)).toEqual({ zoomIn: true, zoomOut: false })
    expect(zoomButtonsDisabled(21.999, BOUNDS)).toEqual({ zoomIn: false, zoomOut: false })
  })

  it('disables zoom out at the min zoom and not a hair above it', () => {
    expect(zoomButtonsDisabled(0, BOUNDS)).toEqual({ zoomIn: false, zoomOut: true })
    expect(zoomButtonsDisabled(0.001, BOUNDS)).toEqual({ zoomIn: false, zoomOut: false })
  })
})

describe('northResetEase', () => {
  // A press turns the map to north and nothing else: flattening a 3D view is
  // the 2D/3D button's job, and an ease without a pitch keeps the current one.
  it('turns to north and leaves the pitch where it is', () => {
    const ease = northResetEase({ reducedMotion: false })
    expect(ease.bearing).toBe(0)
    expect(ease).not.toHaveProperty('pitch')
  })

  it('jumps instead of animating when the reader asked for reduced motion', () => {
    expect(northResetEase({ reducedMotion: true }).duration).toBe(0)
    expect(northResetEase({ reducedMotion: false }).duration).toBeGreaterThan(0)
  })
})

describe('nodePosTap', () => {
  it('cycles a member through every stop and back to off', () => {
    let mode = 'off'
    const seen = []
    for (let i = 0; i < NODEPOS_MODES.length; i++) {
      const tap = nodePosTap(mode, { roleKnown: true, reason: null })
      expect(tap.reason).toBe(null)
      expect(tap.wait).toBe(false)
      mode = tap.mode
      seen.push(mode)
    }
    expect(seen).toEqual(['positions', 'reach', 'off'])
  })

  // The button stays enabled below member so a tap can say why nothing
  // happens: a disabled button answers nobody. Only from off: a role that drops
  // below member switches the layer off first (applyObserverGate).
  it('keeps a guest at off and hands back the reason instead', () => {
    expect(nodePosTap('off', { roleKnown: true, reason: 'Log in.' }))
      .toEqual({ mode: 'off', reason: 'Log in.', wait: false })
  })

  // Before /api/auth/me answers there is no role to decide with. Cycling then
  // gave a guest a member-only stop and wrote it to the URL until the gate took
  // it back; refusing then told a member to log in. The tap waits for the role.
  it('waits for the role instead of deciding without one', () => {
    for (const reason of [null, 'Log in.']) {
      expect(nodePosTap('off', { roleKnown: false, reason }), String(reason))
        .toEqual({ mode: 'off', reason: null, wait: true })
    }
  })
})
