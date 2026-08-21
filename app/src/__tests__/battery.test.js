import { describe, it, expect } from 'vitest'
import { parseStatsCore, mvToPercent, isLowBattery, isMultiCell } from '../battery.js'

// Builds a STATS_TYPE_CORE (11-byte) frame from field values, little-endian,
// so test fixtures can't drift out of sync with hand-typed hex.
function statsCoreFrame({ responseCode = 24, statsType = 0, batteryMv = 3700, uptimeSecs = 3600, errors = 0, queueLen = 2 } = {}) {
  const b = new Uint8Array(11)
  const dv = new DataView(b.buffer)
  dv.setUint8(0, responseCode)
  dv.setUint8(1, statsType)
  dv.setUint16(2, batteryMv, true)
  dv.setUint32(4, uptimeSecs, true)
  dv.setUint16(8, errors, true)
  dv.setUint8(10, queueLen)
  return b
}

describe('parseStatsCore', () => {
  it('parses a real RESP_CODE_STATS/STATS_TYPE_CORE frame', () => {
    const info = parseStatsCore(statsCoreFrame({ batteryMv: 3700, uptimeSecs: 3600, errors: 0, queueLen: 2 }))
    expect(info.batteryMv).toBe(3700)
    expect(info.uptimeSecs).toBe(3600)
    expect(info.errors).toBe(0)
    expect(info.queueLen).toBe(2)
  })

  it('rejects a frame with the wrong response code', () => {
    expect(parseStatsCore(statsCoreFrame({ responseCode: 0 }))).toBeNull()
  })

  it('rejects a frame with the wrong stats sub-type', () => {
    expect(parseStatsCore(statsCoreFrame({ statsType: 1 }))).toBeNull()
  })

  it('returns null for a frame shorter than 11 bytes', () => {
    expect(parseStatsCore(statsCoreFrame().slice(0, 4))).toBeNull()
  })
})

  // src/helpers/ESP32Board.h:  return 0;  // not supported
  // src/helpers/stm32/STM32Board.h:  return 0;  // not supported
  // A literal zero means the board has no VBAT sense, not an empty pack. Read
  // as a real value it renders 0.00V (~0%) in the low style and pins the BLE
  // dot amber for an entire drive on a USB-powered companion.
  it('maps firmware\'s 0mV not-supported sentinel to null, not to an empty pack', () => {
    const info = parseStatsCore(statsCoreFrame({ batteryMv: 0 }))
    expect(info).not.toBeNull()
    expect(info.batteryMv).toBeNull()
  })

  it('keeps the other fields when the battery is unsupported', () => {
    const info = parseStatsCore(statsCoreFrame({ batteryMv: 0, uptimeSecs: 7200, errors: 3, queueLen: 5 }))
    expect(info).toMatchObject({ uptimeSecs: 7200, errors: 3, queueLen: 5 })
  })

  it('treats 1mV as a real reading — only an exact 0 is the sentinel', () => {
    expect(parseStatsCore(statsCoreFrame({ batteryMv: 1 })).batteryMv).toBe(1)
  })

describe('mvToPercent — firmware\'s curve, not one of ours', () => {
  // The endpoints are BATT_MIN/MAX_MILLIVOLTS from
  // examples/companion_radio/ui-new/UITask.cpp (3000/4200). Asserting against
  // firmware's own arithmetic is the whole point: an app that disagrees with
  // the number on the companion's screen is worse than one showing nothing.
  const firmwarePct = (mv) => Math.round(((mv - 3000) * 100) / (4200 - 3000))

  it('matches the companion\'s own percentage across the range', () => {
    for (const mv of [3000, 3200, 3500, 3600, 3700, 3900, 4200]) {
      expect(mvToPercent(mv)).toBe(firmwarePct(mv))
    }
  })

  it('agrees with the companion at 3500mV — the case the old 3200 floor got wrong', () => {
    // Old curve: (3500-3200)/1000 = 30%. Firmware: (3500-3000)/1200 = 42%.
    // Two devices in one hand disagreeing by 12 points is the user-visible bug.
    expect(mvToPercent(3500)).toBe(42)
  })

  it('clamps to 100 at or above 4200mV (full)', () => {
    expect(mvToPercent(4200)).toBe(100)
    expect(mvToPercent(4350)).toBe(100)
  })

  it('clamps to 0 at or below 3000mV (firmware\'s empty)', () => {
    expect(mvToPercent(3000)).toBe(0)
    expect(mvToPercent(2800)).toBe(0)
  })

  it('returns null for a non-finite input', () => {
    expect(mvToPercent(null)).toBeNull()
    expect(mvToPercent(undefined)).toBeNull()
  })
})

// variants/lilygo_tbeam_1w/platformio.ini overrides the #ifndef-guarded
// defaults to -D BATT_MIN_MILLIVOLTS=6000 / -D BATT_MAX_MILLIVOLTS=8400, i.e.
// a 2S pack. We cannot read a build flag over the wire, so a percentage would
// be a guess — and the old curve's guess was the worst possible one: a
// genuinely flat 2S pack at 6100mV clamped to 100% and raised no warning at
// all, right up to the drop this feature exists to prevent.
describe('multi-cell packs report voltage without a percentage', () => {
  it('gives no percentage for a 2S reading', () => {
    expect(mvToPercent(6100)).toBeNull()
    expect(mvToPercent(7400)).toBeNull()
    expect(mvToPercent(8400)).toBeNull()
  })

  it('identifies them as multi-cell', () => {
    expect(isMultiCell(6100)).toBe(true)
    expect(isMultiCell(3700)).toBe(false)
  })

  it('still allows a charging single cell above nominal full', () => {
    expect(isMultiCell(4350)).toBe(false)
    expect(mvToPercent(4350)).toBe(100)
  })

  it('never warns on a pack whose endpoints it cannot know', () => {
    // Not "the 2S pack is fine" — it is "we must not claim either way".
    expect(isLowBattery(6100)).toBe(false)
  })
})

describe('isLowBattery', () => {
  it('warns below the firmware threshold', () => {
    expect(isLowBattery(3200)).toBe(true)
    expect(isLowBattery(3000)).toBe(true)
  })

  it('does not warn mid-pack', () => {
    expect(isLowBattery(3700)).toBe(false)
    expect(isLowBattery(4200)).toBe(false)
  })

  // The whole point of #380: firmware's ui-orig flags low at 3500 mV, and this
  // app used to sit 260 mV under it, calling a pack healthy after the
  // companion's own screen had already warned. Both sides of the boundary, and
  // the comparison is strictly-less to match `getBattMilliVolts() <
  // LOW_BATT_MILLIVOLTS` — at exactly 3500 firmware does NOT warn.
  it('agrees with the companion at the firmware boundary', () => {
    expect(isLowBattery(3499)).toBe(true)
    expect(isLowBattery(3500)).toBe(false)
    expect(isLowBattery(3501)).toBe(false)
  })

  // The band this used to get wrong: above the old 20% mark (3240 mV) and
  // below firmware's. Every value here was previously reported as fine while
  // the companion was already showing low.
  it('warns across the band the old 20% rule called healthy', () => {
    for (const mv of [3250, 3300, 3400, 3499]) expect(isLowBattery(mv), `${mv} mV`).toBe(true)
  })

  it('is false for a non-finite reading (nothing to warn about yet)', () => {
    expect(isLowBattery(null)).toBe(false)
    expect(isLowBattery(undefined)).toBe(false)
  })

  // The sentinel case: 0 is "no VBAT sense", so it must not read as flat.
  it('does not warn on the not-supported sentinel once parsed', () => {
    const info = parseStatsCore(statsCoreFrame({ batteryMv: 0 }))
    expect(info.batteryMv).toBeNull()
    expect(isLowBattery(info.batteryMv)).toBe(false)
  })
})
