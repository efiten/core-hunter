import { describe, it, expect } from 'vitest'
import { frameAirtimeMs, cycleAirtimeMs, minPeriodMs, preambleSymbols, DEFAULT_SF, DISCOVER_BYTES, TRACE_BYTES } from '../airtime.js'
import { INTERVAL_MS } from '../autoping.js'

// Worked example, by hand, from RadioLib's getTimeOnAir (the function the
// firmware's getEstAirtimeFor calls), for the firmware default preset:
// SF8, BW 62.5 kHz, CR 4/5, explicit header, CRC on, 32-symbol preamble.
//   symbol = 2^8 / 62.5 kHz = 4096 us
//   12 bytes: bits = 8*12 + 16 - 4*8 + 8 + 20 = 108 -> ceil(108/32) = 4 coded groups
//   symbols*4 = (32 + 8)*4 + 17 + 4*5*4 = 257 -> 4096 * 257 / 4 = 263168 us
describe('frameAirtimeMs', () => {
  it('matches RadioLib time-on-air for a trace-ping at the firmware default preset', () => {
    expect(frameAirtimeMs(12, { sf: 8 })).toBe(263)
  })

  it('takes the preamble the firmware sets per spreading factor', () => {
    // RadioLibWrappers.h: preambleLengthForSF(sf) = sf <= 8 ? 32 : 16.
    expect(preambleSymbols(8)).toBe(32)
    expect(preambleSymbols(9)).toBe(16)
    // So SF9 is not the doubling of SF8 a symbol-time argument alone gives:
    // it carries half the preamble symbols.
    expect(frameAirtimeMs(12, { sf: 9 })).toBeLessThan(2 * frameAirtimeMs(12, { sf: 8 }))
  })

  it('falls back to the firmware default SF when the companion has not said', () => {
    expect(DEFAULT_SF).toBe(8)
    for (const sf of [null, undefined, 0, 13, 'x']) expect(frameAirtimeMs(12, { sf })).toBe(frameAirtimeMs(12, { sf: 8 }))
  })

  it('never shortens for more bytes', () => {
    expect(frameAirtimeMs(TRACE_BYTES, { sf: 7 })).toBeGreaterThanOrEqual(frameAirtimeMs(DISCOVER_BYTES, { sf: 7 }))
  })
})

// The floor is the airtime the cycle spent divided by the budget: at 10% a
// cycle that took 1.3 s on air has to be followed by 13 s of silence.
describe('minPeriodMs', () => {
  const sweepOf4 = [DISCOVER_BYTES, TRACE_BYTES, TRACE_BYTES, TRACE_BYTES, TRACE_BYTES]

  it('sums the frames a cycle sent', () => {
    expect(cycleAirtimeMs(sweepOf4, 8)).toBe(frameAirtimeMs(8, { sf: 8 }) + 4 * 263)
    expect(cycleAirtimeMs([], 8)).toBe(0)
  })

  it('binds standing still for a sweep of four at SF8, and not for one target at SF7', () => {
    expect(minPeriodMs(sweepOf4, 8)).toBeGreaterThan(INTERVAL_MS)
    expect(minPeriodMs([DISCOVER_BYTES, TRACE_BYTES], 7)).toBeLessThan(INTERVAL_MS)
  })

  it('is nothing for a cycle that sent nothing', () => {
    expect(minPeriodMs([], 8)).toBe(0)
  })
})
