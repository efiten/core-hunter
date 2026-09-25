import { describe, it, expect } from 'vitest'
import { buildStatsRadioRequest, parseStatsRadio, shouldSampleNoise, noiseSample, noiseCells, noiseFill, withNoise, noiseHexFC, NOISE_BANDS, CMD_GET_STATS, RESP_CODE_STATS, STATS_TYPE_RADIO } from '../noise.js'
import { INTERVAL_MS, MOVE_THRESHOLD_M } from '../autoping.js'

// STATS_TYPE_RADIO (docs/stats_binary_frames.md in meshcore-dev/MeshCore), 14
// bytes, little-endian: [24][1][noise_floor int16][last_rssi int8]
// [last_snr int8, x4][tx_air_secs u32][rx_air_secs u32].
const frame = (noise, len = 14) => {
  const b = new Uint8Array(len)
  b[0] = RESP_CODE_STATS; b[1] = STATS_TYPE_RADIO
  new DataView(b.buffer).setInt16(2, noise, true)
  return b
}

describe('the stats request and its radio reply (#410)', () => {
  it('asks for the radio sub-type', () => {
    expect([...buildStatsRadioRequest()]).toEqual([CMD_GET_STATS, STATS_TYPE_RADIO])
    expect(CMD_GET_STATS).toBe(56)
  })
  it('reads a negative noise floor with its sign', () => {
    expect(parseStatsRadio(frame(-112))).toEqual({ noiseFloor: -112 })
    expect(parseStatsRadio(frame(-140))).toEqual({ noiseFloor: -140 })
  })
  it('reads 0 as not measured yet, not as a loud place', () => {
    // The firmware holds the noise floor at 0 from begin() and every AGC
    // reset until 64 samples are averaged (RadioLibWrappers.cpp:37, :82-100).
    expect(parseStatsRadio(frame(0))).toEqual({ noiseFloor: null })
    expect(parseStatsRadio(frame(5))).toEqual({ noiseFloor: null })
    expect(parseStatsRadio(frame(-120))).toEqual({ noiseFloor: -120 })
  })
  it('refuses another sub-type, another code, and a short frame', () => {
    const core = frame(-100); core[1] = 0
    expect(parseStatsRadio(core)).toBeNull()
    const other = frame(-100); other[0] = 5
    expect(parseStatsRadio(other)).toBeNull()
    expect(parseStatsRadio(frame(-100, 13))).toBeNull()
    expect(parseStatsRadio(null)).toBeNull()
  })
  it('leaves a value outside what the firmware reports (-140 to +10 dBm) as no reading', () => {
    expect(parseStatsRadio(frame(-141))).toEqual({ noiseFloor: null })
    expect(parseStatsRadio(frame(11))).toEqual({ noiseFloor: null })
  })
})

// The same rhythm as auto-discover (Kasper, 2026-09-25): every 10 s, or
// sooner after 50 m. Unlike auto-discover it runs whether that is on or not:
// the reading is a BLE query and puts nothing on air.
describe('shouldSampleNoise', () => {
  const at = { lat: 51.84, lon: 5.84 }
  it('samples the first time, and again after the auto-discover interval', () => {
    expect(shouldSampleNoise({ last: null, now: 0, ...at })).toBe(true)
    expect(shouldSampleNoise({ last: { at: 0, ...at }, now: INTERVAL_MS - 1, ...at })).toBe(false)
    expect(shouldSampleNoise({ last: { at: 0, ...at }, now: INTERVAL_MS, ...at })).toBe(true)
  })
  it('samples sooner once the phone has moved the auto-discover distance', () => {
    const moved = { lat: at.lat + (MOVE_THRESHOLD_M + 5) / 111320, lon: at.lon }
    expect(shouldSampleNoise({ last: { at: 0, ...at }, now: 2000, ...moved })).toBe(true)
  })
})

describe('noiseSample', () => {
  const fix = { lat: 51.84, lon: 5.84, acc_m: 8 }
  it('is one record with the position, the session and the reading', () => {
    expect(noiseSample({ noiseFloor: -110, fix, session: 's1', rxPubkey: 'AB', nowMs: Date.parse('2026-09-25T10:00:00Z'), last: null }))
      .toEqual({ at: '2026-09-25T10:00:00.000Z', lat: 51.84, lon: 5.84, acc_m: 8, noise_floor: -110, session: 's1', rx_pubkey: 'ab', stationary: false })
  })
  it('marks a sample taken within the move distance of the last one as stationary', () => {
    const last = { at: 0, lat: 51.84, lon: 5.84 }
    expect(noiseSample({ noiseFloor: -110, fix, session: 's1', rxPubkey: 'ab', nowMs: 10000, last }).stationary).toBe(true)
    const far = { ...fix, lat: 51.85 }
    expect(noiseSample({ noiseFloor: -110, fix: far, session: 's1', rxPubkey: 'ab', nowMs: 10000, last }).stationary).toBe(false)
  })
  it('is no sample without a reading or without a fix', () => {
    expect(noiseSample({ noiseFloor: null, fix, session: 's', rxPubkey: 'ab', nowMs: 0, last: null })).toBeNull()
    expect(noiseSample({ noiseFloor: -110, fix: null, session: 's', rxPubkey: 'ab', nowMs: 0, last: null })).toBeNull()
  })
})

// A cell shows the median noise floor of what was measured in it. A park is
// one place, not a hundred readings of it: a run of stationary samples in one
// cell and one session counts once, as its own median, so ten minutes at a
// red light cannot outvote one pass.
describe('noiseCells', () => {
  const cellOf = (s) => s.cell
  const s = (cell, noise, stationary = false, session = 'a') => ({ cell, noise_floor: noise, stationary, session })
  it('gives each cell the median of its samples', () => {
    const out = noiseCells([s('x', -120), s('x', -110), s('x', -100), s('y', -95)], cellOf)
    expect(out.get('x')).toEqual({ median: -110, n: 3 })
    expect(out.get('y')).toEqual({ median: -95, n: 1 })
  })
  it('counts a park in one cell once, however long it lasted', () => {
    const park = Array.from({ length: 60 }, () => s('x', -90, true))
    const out = noiseCells([s('x', -120), s('x', -118), ...park], cellOf)
    // Without the collapse the 60 parked readings would make it -90.
    expect(out.get('x')).toEqual({ median: -118, n: 3 })
  })
  it('keeps two sessions parked in one cell as two readings', () => {
    const out = noiseCells([s('x', -120, true, 'a'), s('x', -100, true, 'b')], cellOf)
    expect(out.get('x').n).toBe(2)
  })
  it('takes the mean of the middle two for an even count', () => {
    expect(noiseCells([s('x', -120), s('x', -110)], cellOf).get('x').median).toBe(-115)
  })
})

describe('the noise layer on the map (#410)', () => {
  it('leaves a quiet cell clear and paints each louder band with its own token', () => {
    const fill = noiseFill(['a', 'b', 'c', 'd'])
    expect(fill).toEqual(['step', ['get', 'nf'], 'rgba(0,0,0,0)', NOISE_BANDS[0], 'a', NOISE_BANDS[1], 'b', NOISE_BANDS[2], 'c', NOISE_BANDS[3], 'd'])
    // Louder is higher: the bands climb, so a step expression reads them.
    expect([...NOISE_BANDS].sort((x, y) => x - y)).toEqual(NOISE_BANDS)
  })

  it('takes the place of the signal cells, in every view (Kasper, 2026-09-25)', () => {
    const points = { hex: false, 'hex-3d': false, points: true, 'points-3d': false, 'hex-labels': false, pulse: true, 'pulse-3d': false }
    const hex3d = { hex: false, 'hex-3d': true, points: false, 'points-3d': false, 'hex-labels': false, pulse: false, 'pulse-3d': false }
    const both = { hex: true, 'hex-3d': false, points: true, 'points-3d': false, 'hex-labels': true, pulse: true, 'pulse-3d': false }
    expect(withNoise(points, true)).toEqual({ ...points, noise: true })
    expect(withNoise(hex3d, true)).toEqual({ ...hex3d, 'hex-3d': false, noise: true })
    expect(withNoise(both, true)).toEqual({ ...both, hex: false, 'hex-labels': false, noise: true })
  })

  it('changes nothing with the layer off', () => {
    const both = { hex: true, 'hex-3d': false, points: true, 'hex-labels': true }
    expect(withNoise(both, false)).toEqual({ ...both, noise: false })
  })

  it('draws one hex per cell, carrying its median', () => {
    const samples = [
      { lat: 51.84, lon: 5.85, noise_floor: -100, stationary: false, session: 's' },
      { lat: 51.84, lon: 5.85, noise_floor: -110, stationary: false, session: 's' },
      { lat: 52.0, lon: 5.0, noise_floor: -120, stationary: false, session: 's' },
    ]
    const cellAt = (lat) => (lat > 51.9 ? 'far' : 'near')
    const boundary = (id) => (id === 'near' ? [[0, 0], [0, 1], [1, 1], [0, 0]] : [[2, 2], [2, 3], [3, 3], [2, 2]])
    const fc = noiseHexFC(samples, cellAt, boundary)
    expect(fc.features.map((f) => f.properties)).toEqual([{ nf: -105, count: 2 }, { nf: -120, count: 1 }])
    // hexBoundary answers [lat, lon]; GeoJSON wants [lon, lat].
    expect(fc.features[0].geometry).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })
  })

  it('skips a cell whose boundary does not parse', () => {
    const fc = noiseHexFC([{ lat: 1, lon: 1, noise_floor: -100 }], () => 'x', () => null)
    expect(fc.features).toEqual([])
  })
})
