import { describe, it, expect } from 'vitest'
import { hopFilterEffect, warnHopFilter, HOP_NOTICE_MIN } from './hopfilter.js'

// The Amsterdam flood of 2026-08-24, in the shape the map holds it: 2,851
// receptions, hop counts 1..37, not one of them zero, three of them at -34 dBm.
const flood = Array.from({ length: 2851 }, (_, i) => ({ hops: 1 + (i % 37), rssi: i < 3 ? -34 : -95 }))
// Ordinary traffic runs 28-43% zero-hop in every RSSI band.
const normal = Array.from({ length: 100 }, (_, i) => ({ hops: i % 3 === 0 ? 0 : 4, rssi: -90 }))

describe('hopFilterEffect', () => {
  it('sees that the control would empty the map', () => {
    expect(hopFilterEffect(flood)).toMatchObject({ total: 2851, zero: 0, strongest: -34, hidesEverything: true })
  })

  it('does not flag traffic that has zero-hop receptions in it', () => {
    expect(hopFilterEffect(normal).hidesEverything).toBe(false)
  })

  it('is not fooled by an empty set', () => {
    // Nothing to hide is not the same as a filter that cannot work, and saying
    // so on an empty map would fire on every page load before data arrives.
    expect(hopFilterEffect([]).hidesEverything).toBe(false)
    for (const junk of [null, undefined, 'nope']) expect(hopFilterEffect(junk).total).toBe(0)
  })

  it('ignores rows carrying no hop count rather than counting them as zero', () => {
    // A row without the field is not evidence either way; treating it as 0
    // would make a set of them look healthy and suppress the notice.
    expect(hopFilterEffect([{ rssi: -90 }, { hops: null }, { hops: 3 }])).toMatchObject({ total: 1, zero: 0 })
  })
})

describe('warnHopFilter', () => {
  it('says nothing until the sample can support it', () => {
    // Absolute sizes, not HOP_NOTICE_MIN arithmetic: a fixture written against
    // the constant moves with it, so lowering the floor would keep passing.
    //
    // Against the 30% zero-hop baseline that real traffic runs at, seeing none
    // in 5 receptions is a 17% coincidence — an ordinary quiet minute, and a
    // notice that fires on it becomes noise. In 10 it is still 2.8%. At 20 it
    // is 0.08%, which is a finding.
    expect(warnHopFilter(flood.slice(0, 5)), 'five is a quiet minute').toBe('')
    expect(warnHopFilter(flood.slice(0, 10)), 'ten is still a coincidence').toBe('')
    expect(warnHopFilter(flood.slice(0, 20)), 'twenty is a finding').not.toBe('')
  })

  it('keeps the floor where the arithmetic puts it', () => {
    // The number itself, so a change to it is a decision rather than a drift.
    expect(HOP_NOTICE_MIN).toBe(20)
  })

  it('says nothing about traffic the control would work on', () => {
    expect(warnHopFilter(normal)).toBe('')
    expect(warnHopFilter(normal, { active: true })).toBe('')
  })

  it('reports what happened when the control is already on, and what would happen when it is not', () => {
    expect(warnHopFilter(flood, { active: true })).toMatch(/hiding all 2,851/)
    expect(warnHopFilter(flood)).toMatch(/would hide every one/)
  })

  it('mentions a close reception, because that is what makes the claim absurd', () => {
    // -34 dBm is metres away. A hop count of 8 on it is the whole point.
    expect(warnHopFilter(flood)).toContain('-34 dBm')
    const farOnly = flood.map((p) => ({ ...p, rssi: -95 }))
    expect(warnHopFilter(farOnly)).not.toContain('dBm, which is close')
  })

  it('talks about the data and never about the sender', () => {
    // "This sender is lying" cannot be checked from one reception (#321).
    // "None of these reports zero hops" can.
    for (const active of [true, false]) {
      const s = warnHopFilter(flood, { active }).toLowerCase()
      for (const word of ['fake', 'forged', 'spoof', 'lying', 'attack']) expect(s).not.toContain(word)
    }
  })
})
