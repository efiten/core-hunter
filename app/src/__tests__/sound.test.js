import { describe, it, expect } from 'vitest'
import { SOUND_MODES, nextSoundMode, harmFreq, pingGain, receptionCue, cueFamily, coalesceCue, CUE_GAP_MS, createSoundEngine } from '../sound.js'
import { FILTER_PACKET_TYPES } from '../filters.js'
import { RSSI_WEAK_DBM, RSSI_STRONG_DBM } from '../signal.js'

describe('nextSoundMode', () => {
  it('cycles off → rxtx → full → off', () => {
    expect(nextSoundMode('off')).toBe('rxtx')
    expect(nextSoundMode('rxtx')).toBe('full')
    expect(nextSoundMode('full')).toBe('off')
  })
  it('falls back to off for unknown values (corrupt/pre-#255 storage)', () => {
    expect(nextSoundMode('geiger')).toBe('rxtx')
    expect(nextSoundMode(null)).toBe('rxtx')
  })
  it('exposes the three modes in cycle order', () => {
    expect(SOUND_MODES).toEqual(['off', 'rxtx', 'full'])
  })
})

describe('harmFreq — RSSI quantized to the harmonic series of F2', () => {
  const F2 = 87.31
  it('maps the weak end (-125 dBm) to the 4th harmonic (F4)', () => {
    expect(harmFreq(-125)).toBeCloseTo(F2 * 4, 5)
  })
  it('maps the strong end (-75 dBm) to the 24th harmonic (C7)', () => {
    expect(harmFreq(-75)).toBeCloseTo(F2 * 24, 5)
  })

  // #471: the step size is the coarsest thing about the instrument, and it is
  // coarsest exactly where you are closing in. Asserted as a property over the
  // whole band rather than by retyping the ladder, so it fails for the reason
  // it is about: a step you could drive through without hearing.
  it('never leaves more than 5 dB inside one step', () => {
    const seen = []
    for (let db = RSSI_WEAK_DBM; db <= RSSI_STRONG_DBM; db += 0.25) {
      const f = harmFreq(db)
      if (!seen.length || seen[seen.length - 1].f !== f) seen.push({ db, f })
    }
    const widest = seen.slice(1).reduce((w, s, i) => Math.max(w, s.db - seen[i].db), 0)
    expect(widest).toBeLessThanOrEqual(5)
  })

  // The consonance rule is "overtone of F2", not "pentatonic" -- and the
  // overtones that are NOT scale degrees are the ones that would clash: 7, 11,
  // 13 and 14 sit up to a quarter-tone between the keys.
  it('uses only overtones of the root, and none of the out-of-tune ones', () => {
    const ratios = new Set()
    for (let db = RSSI_WEAK_DBM; db <= RSSI_STRONG_DBM; db += 0.25) ratios.add(harmFreq(db) / F2)
    for (const r of ratios) {
      expect(Math.abs(r - Math.round(r))).toBeLessThan(1e-6)
      expect([7, 11, 13, 14]).not.toContain(Math.round(r))
    }
  })
  // The step size is what you actually hunt by: closing from -95 to -88 dBm
  // has to be audible as a rise, not absorbed inside one harmonic. Widening
  // the band to -125 without an eighth step would have swallowed it (#282).
  it('rises across a 7 dB gain at close range', () => {
    expect(harmFreq(-88)).toBeGreaterThan(harmFreq(-95))
  })
  // The band bottomed out at -115, so the whole sub -115 fringe pinged
  // identically — the same flattening the map had before #282.
  it('still rises across the sub -115 fringe', () => {
    expect(harmFreq(-115)).toBeGreaterThan(harmFreq(-125))
  })
  it('clamps outside the band', () => {
    expect(harmFreq(-140)).toBeCloseTo(harmFreq(-125), 5)
    expect(harmFreq(-20)).toBeCloseTo(harmFreq(-75), 5)
  })
  it('quantizes — nearby RSSI values land on the same harmonic', () => {
    expect(harmFreq(-96)).toBeCloseTo(harmFreq(-97), 5)
  })
  // Outside the band too, not just inside it: the clamp must not fall off the
  // ladder into an arbitrary multiple. (The membership check that used to live
  // here retyped the ladder itself, so it could only fail when someone edited
  // the array and forgot the test; the property test above is what pins the
  // rule.)
  it('stays on the ladder either side of the band', () => {
    for (const rssi of [-130, -128, -72, -70]) {
      const h = harmFreq(rssi) / F2
      expect(Math.abs(h - Math.round(h))).toBeLessThan(1e-6)
    }
  })
  it('applies the plot offset (calibration + attenuator), same as the map', () => {
    // -105 raw with +10 offset ≡ -95 calibrated
    expect(harmFreq(-105, 10)).toBeCloseTo(harmFreq(-95), 5)
  })
  it('takes the weak/strong anchors from signal.js, so HUD, map and ping agree', () => {
    expect(harmFreq(RSSI_WEAK_DBM)).toBeCloseTo(F2 * 4, 5)
    expect(harmFreq(RSSI_STRONG_DBM)).toBeCloseTo(F2 * 24, 5)
  })
  it('defaults a missing RSSI to the lowest harmonic', () => {
    expect(harmFreq(null)).toBeCloseTo(F2 * 4, 5)
    expect(harmFreq(undefined)).toBeCloseTo(F2 * 4, 5)
  })
})

describe('pingGain', () => {
  it('is quieter at the weak end than at the strong end', () => {
    expect(pingGain(-115)).toBeLessThan(pingGain(-75))
  })
  it('stays within (0, 1]', () => {
    expect(pingGain(-140)).toBeGreaterThan(0)
    expect(pingGain(-20)).toBeLessThanOrEqual(1)
  })
})

// #468: every reception the app records must be able to be heard. What used to
// be a yes/no gate now answers WHICH cue, because the distinction is the only
// thing that keeps the majority class from drowning the one you steer by.
describe('receptionCue', () => {
  const direct = { hops: 0, rssi: -90, packet_type: 'Advert' }

  it('names a cue for a zero-hop reception in both sounding modes', () => {
    expect(receptionCue(direct, 'rxtx')).toEqual({ family: 'advert', damped: false })
    expect(receptionCue(direct, 'full')).toEqual({ family: 'advert', damped: false })
  })

  it('says nothing when sound is off, or when there is no reception', () => {
    expect(receptionCue(direct, 'off')).toBeNull()
    expect(receptionCue(null, 'rxtx')).toBeNull()
  })

  // The gate this replaces refused these outright. A relayed packet is a real
  // reception of a real transmitter (the repeater that forwarded it), so it is
  // audible -- damped, because it reached us through something.
  it('damps a relayed reception instead of silencing it', () => {
    expect(receptionCue({ ...direct, hops: 2 }, 'rxtx')).toEqual({ family: 'advert', damped: true })
  })

  // No filter argument at all: narrowing the map must not narrow what the
  // radio is heard to have heard.
  it('takes no filter, so a target selection cannot mute anything', () => {
    expect(receptionCue.length).toBe(2)
  })

  it('gives a reception with no identifiable sender the voice of its type', () => {
    expect(receptionCue({ hops: 0, rssi: -110, packet_type: 'Trace', sender_id: null }, 'rxtx'))
      .toEqual({ family: 'trace', damped: false })
  })
})

describe('cueFamily', () => {
  it('groups the types a hunter reads differently', () => {
    expect(cueFamily('Advert')).toBe('advert')
    expect(cueFamily('GroupText')).toBe('channel')
    expect(cueFamily('GroupData')).toBe('channel')
    expect(cueFamily('TextMessage')).toBe('message')
    expect(cueFamily('Trace')).toBe('trace')
  })

  // The measured majority (RESPONSE 71k, REQ 46k, PATH 17k of the newly
  // captured traffic, #455) shares the driest voice, or it becomes a drone.
  it('puts the network chatter in one dry family', () => {
    for (const t of ['Response', 'Request', 'AnonRequest', 'Ack', 'Control', 'Path', 'Multipart', 'RawCustom']) {
      expect(cueFamily(t)).toBe('network')
    }
  })

  // An unrecognised type must not fall into a prominent voice by accident --
  // same reasoning as #341's chip coverage, in the other direction.
  it('defaults an unknown or absent type to the dry family', () => {
    expect(cueFamily('SomethingNew')).toBe('network')
    expect(cueFamily(null)).toBe('network')
    expect(cueFamily(undefined)).toBe('network')
  })

  it('has a family for every type the filter chips can name', () => {
    const known = new Set(['advert', 'channel', 'message', 'network', 'trace'])
    for (const t of FILTER_PACKET_TYPES) expect(known.has(cueFamily(t.value))).toBe(true)
  })
})

// The coalescer decides what survives a burst. It is pure so the rule can be
// pinned: the least important sound must never eat the most important one.
describe('coalesceCue', () => {
  const direct = { family: 'network', damped: false }
  const relayed = { family: 'network', damped: true }

  it('lets a direct cue through even in a burst of relayed ones', () => {
    let st = {}
    ;({ state: st } = coalesceCue(st, relayed, 1000))
    const r = coalesceCue(st, direct, 1010)
    expect(r.play).toBe(true)
  })

  it('holds a relayed cue that follows another of its family too closely', () => {
    const { state } = coalesceCue({}, relayed, 1000)
    expect(coalesceCue(state, relayed, 1000 + CUE_GAP_MS - 1).play).toBe(false)
    expect(coalesceCue(state, relayed, 1000 + CUE_GAP_MS).play).toBe(true)
  })

  it('holds a relayed cue in the shadow of a direct one', () => {
    const { state } = coalesceCue({}, direct, 1000)
    expect(coalesceCue(state, { family: 'advert', damped: true }, 1010).play).toBe(false)
  })

  it('lets different families sound close together', () => {
    const { state } = coalesceCue({}, { family: 'network', damped: true }, 1000)
    expect(coalesceCue(state, { family: 'advert', damped: true }, 1010).play).toBe(true)
  })

  // Review of #470, measured on the ingestor DB: 39.2% of consecutive receptions
  // share a timestamp to the millisecond, in groups of up to 40. Batched BLE
  // frames land in one turn and carry one rx_at, so without a gap of their own
  // 40 direct cues start at the same ac.currentTime and sum into one transient
  // instead of sounding like 40 dits. Direct cues yield to each other; what they
  // must not yield to is a relayed one, which is the test above.
  it('holds a direct cue that follows another direct one inside the gap', () => {
    const { state } = coalesceCue({}, direct, 1000)
    expect(coalesceCue(state, direct, 1000).play).toBe(false)
    expect(coalesceCue(state, direct, 1000 + CUE_GAP_MS - 1).play).toBe(false)
    expect(coalesceCue(state, direct, 1000 + CUE_GAP_MS).play).toBe(true)
  })

  it('holds a direct cue behind a direct one of another family, since they sum in the same instant', () => {
    const { state } = coalesceCue({}, direct, 1000)
    expect(coalesceCue(state, { family: 'advert', damped: false }, 1000).play).toBe(false)
  })

  it('does not mutate the state it is given', () => {
    const st = {}
    coalesceCue(st, direct, 1000)
    expect(st).toEqual({})
  })
})

describe('createSoundEngine without Web Audio (node / unsupported browser)', () => {
  it('degrades to a safe no-op engine', () => {
    const s = createSoundEngine()
    expect(() => {
      s.setMode('full')
      s.cue({ family: 'network', damped: false }, -90, 0)
      s.txBlip('discover')
      s.txBlip('trace')
      s.setMode('off')
      s.destroy()
    }).not.toThrow()
  })
})
