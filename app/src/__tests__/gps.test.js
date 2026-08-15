import { describe, it, expect } from 'vitest'
import { isValidFix, isUsableFix, shouldNoticePoorFix, accuracyLabel, GPS_MAX_ACC_M, POOR_FIX_NOTICE_MS } from '../gps.js'

const fix = (o) => ({ lat: 51.05, lon: 4.12, acc_m: 8, ...o })

describe('isValidFix — coordinates that are safe to plot at all', () => {
  it('accepts an ordinary fix', () => {
    expect(isValidFix(fix())).toBe(true)
  })
  // iOS can emit an invalid CLLocation briefly after resume; a NaN coordinate
  // aborts the map renderer and poisons the published payload (#274).
  it('rejects NaN / non-numeric coordinates', () => {
    expect(isValidFix(fix({ lat: NaN }))).toBe(false)
    expect(isValidFix(fix({ lon: NaN }))).toBe(false)
    expect(isValidFix(fix({ lat: null }))).toBe(false)
    expect(isValidFix(fix({ lon: '4.12' }))).toBe(false)
    expect(isValidFix(fix({ lat: Infinity }))).toBe(false)
  })
  it('rejects out-of-range coordinates', () => {
    expect(isValidFix(fix({ lat: 91 }))).toBe(false)
    expect(isValidFix(fix({ lat: -91 }))).toBe(false)
    expect(isValidFix(fix({ lon: 181 }))).toBe(false)
    expect(isValidFix(fix({ lon: -181 }))).toBe(false)
  })
  it('accepts the exact range bounds and the null island', () => {
    expect(isValidFix({ lat: 90, lon: 180, acc_m: 5 })).toBe(true)
    expect(isValidFix({ lat: 0, lon: 0, acc_m: 5 })).toBe(true)
  })
  it('rejects a missing fix', () => {
    expect(isValidFix(null)).toBe(false)
    expect(isValidFix(undefined)).toBe(false)
  })
})

describe('isUsableFix — accurate enough to record a reception against', () => {
  it('accepts a fix at or under the accuracy threshold', () => {
    expect(isUsableFix(fix({ acc_m: 8 }))).toBe(true)
    expect(isUsableFix(fix({ acc_m: GPS_MAX_ACC_M }))).toBe(true)
  })
  // 13.7% of production receptions were tagged with a fix worse than 50 m and
  // ~1% worse than 300 m, binned into the hex grid as if they were exact.
  it('refuses a fix worse than the threshold', () => {
    expect(isUsableFix(fix({ acc_m: GPS_MAX_ACC_M + 1 }))).toBe(false)
    expect(isUsableFix(fix({ acc_m: 500 }))).toBe(false)
  })
  it('honours an explicit threshold', () => {
    expect(isUsableFix(fix({ acc_m: 80 }), 50)).toBe(false)
    expect(isUsableFix(fix({ acc_m: 40 }), 50)).toBe(true)
  })
  // A device that reports no accuracy at all says nothing about quality, and
  // refusing every reception from it would be worse than recording it.
  it('accepts a fix with no accuracy figure', () => {
    expect(isUsableFix(fix({ acc_m: null }))).toBe(true)
    expect(isUsableFix(fix({ acc_m: undefined }))).toBe(true)
  })
  // CoreLocation reports horizontalAccuracy < 0 to mean "this location is
  // invalid" — the exact case this gate exists for, so it must not read as a
  // perfect fix just because it compares below the threshold.
  it('refuses a negative accuracy, which flags an invalid location', () => {
    expect(isUsableFix(fix({ acc_m: -1 }))).toBe(false)
    expect(isUsableFix(fix({ acc_m: -1000 }))).toBe(false)
  })
  it('refuses a non-finite accuracy', () => {
    expect(isUsableFix(fix({ acc_m: NaN }))).toBe(false)
    expect(isUsableFix(fix({ acc_m: Infinity }))).toBe(false)
  })
  it('is false for anything isValidFix rejects', () => {
    expect(isUsableFix(fix({ lat: NaN }))).toBe(false)
    expect(isUsableFix(null)).toBe(false)
  })
})

describe('accuracyLabel — what the dropped-capture notice says about the fix', () => {
  it('reports a usable figure in whole metres', () => {
    expect(accuracyLabel(fix({ acc_m: 249.6 }))).toBe('±250 m')
  })
  // Reached for every refusal, including the ones refused *because* acc_m is
  // absent, negative or NaN — none of which may render as "±NaN m".
  it('says accuracy is unknown rather than printing a nonsense number', () => {
    expect(accuracyLabel(fix({ acc_m: NaN }))).toBe('accuracy unknown')
    expect(accuracyLabel(fix({ acc_m: null }))).toBe('accuracy unknown')
    expect(accuracyLabel(fix({ acc_m: -1 }))).toBe('accuracy unknown')
    expect(accuracyLabel(null)).toBe('accuracy unknown')
  })
})

describe('shouldNoticePoorFix — throttled "captures are being dropped" notice', () => {
  it('is true the first time', () => {
    expect(shouldNoticePoorFix(null, 1000)).toBe(true)
  })
  it('stays quiet inside the throttle window', () => {
    expect(shouldNoticePoorFix(1000, 1000 + POOR_FIX_NOTICE_MS - 1)).toBe(false)
  })
  it('speaks again once the window has passed', () => {
    expect(shouldNoticePoorFix(1000, 1000 + POOR_FIX_NOTICE_MS)).toBe(true)
  })
})
