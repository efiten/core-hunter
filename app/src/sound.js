// Sound modes (#145): audio feedback while hunting, so you can drive/walk
// without watching the screen. Redefined 2026-07-15 — geiger mode dropped;
// sounds are ALWAYS real: every information-carrying sound corresponds to an
// actual event (a zero-hop reception or an outgoing ping), never synthesized
// ticking. Three states, cycled by the sound FAB (#255):
//   off  — silent (default)
//   rxtx — a cue per recorded reception + the transmit pops, no bed/music;
//          pitch, length and gain scale with RSSI (hotter = higher/longer/
//          louder), on the same fixed dBm band as the HUD bar
//          (RSSI_WEAK_DBM..RSSI_STRONG_DBM, calibration/attenuator offset
//          applied). The packet-type family picks the instrument and a relayed
//          reception is damped rather than silent (#468).
//   full — the surf/air soundbed + generative ambient music (Eno-style, never
//          repeats), with the rx/tx sounds on top. The bed/music carry no
//          information (atmosphere only), so the always-real rule holds.
// Everything is synthesized with Web Audio — no audio assets, works offline.
// The engine degrades to a no-op when Web Audio is unavailable (node tests,
// old WebViews), mirroring the huntmap stub pattern.
// Mix values (reverb wet/decay, music volume/density) were chosen by ear in
// the #145 sound lab — see docs/2026-07-16-sound-modes.md.

// rssiFrac is the HUD thermal bar's own weak..strong mapping, shared so a ping
// "sounds as hot" as the reception looks on the map/HUD. `offset` throughout
// this module is the plot offset (calibration + attenuator).
import { rssiFrac } from './signal.js'

export const SOUND_MODES = ['off', 'rxtx', 'full']

export function nextSoundMode(mode) {
  // Unknown values (corrupt/legacy storage, e.g. the dropped 'geiger') count
  // as 'off', so the next tap lands on 'ping' — indexOf's -1 does that for free.
  const i = SOUND_MODES.indexOf(mode)
  return SOUND_MODES[(Math.max(i, 0) + 1) % SOUND_MODES.length]
}

// RSSI → cue pitch on the HARMONIC SERIES of F2 (87.31 Hz). The generative
// music plays in F-pentatonic, and overtones of F physically cannot beat
// against it — that was the fix for the first attempt, a kalimba tuned to G,
// which fought the music. Hotter signal = higher harmonic.
//
// The rule is "overtone of F2", NOT "pentatonic" (#471). Pentatonic was a
// consequence of stopping at harmonic 16: up to there the overtones happen to
// be F, A, C and G. Continuing the same series adds scale degrees — 15 is E,
// 18 G, 20 A, 24 C — with the physical argument unchanged. Harmonics 7, 11, 13
// and 14 stay out: those land between the keys, up to a quarter-tone off, and
// they genuinely do clash.
//
// Twelve steps across the 50 dB band is 4.5 dB each, against 7.1 for the eight
// of #282 — and 7.1 was already wide enough to swallow the 7 dB gain at close
// range that #282 itself calls "exactly the change you hunt by".
//
// Extended UP rather than down, though the traffic got denser at the weak end
// after #455: harmonics 2 and 3 are F3 and C4, and below roughly 300 Hz a
// phone speaker in a moving car gives up. Resolution you cannot hear is not
// resolution, and the strong end is where you steer.
const HARM_ROOT_HZ = 87.31 // F2
const HARMONICS = [4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20, 24]
export function harmFreq(rssi, offset = 0) {
  return HARM_ROOT_HZ * HARMONICS[Math.round(rssiFrac(rssi, offset) * (HARMONICS.length - 1))]
}

// Ping loudness: 0.25 (weak) → 0.65 (strong) — never fully silent, with
// headroom over the soundbed and music.
export function pingGain(rssi, offset = 0) {
  return 0.25 + rssiFrac(rssi, offset) * 0.4
}

// Which cue a reception gets (#468). Everything the app records is audible:
// nothing in the pipeline may make a reception permanently unhearable as a
// side effect of something unrelated to the reception itself.
//
// Two conditions this deliberately no longer has:
//
// - The FILTER. It is a lens on the map, not on what the radio heard, and
//   narrowing to one target used to silence everything else. There is no
//   filter argument any more, so no future caller can reintroduce that.
// - hops === 0. A relayed packet is a real reception of a real transmitter --
//   the repeater that forwarded it, which this app will happily let you select
//   as a target. Only the ORIGINATOR's position needs zero hops (AGENTS.md §1).
//   It is damped rather than dropped, because it reached us through something.
//
// A reception with no usable GPS fix is the one carve-out, and it is enforced
// upstream: shouldCapture refuses it, so it never gets here (#274).
export function receptionCue(rec, mode) {
  if (mode === 'off' || !rec) return null
  return { family: cueFamily(rec.packet_type), damped: rec.hops !== 0 }
}

// Packet type -> cue family. The type survives even when the sender cannot be
// named (#454), so the instrument carries WHAT is transmitting even when
// nothing can say WHO -- which is why identity is not an audio dimension.
//
// Families, not one voice per chip: four to six timbres is what anyone tells
// apart in a 35-95 ms event in a moving car. The grouping follows the measured
// distribution (#455): the rarer and more informative the type, the more
// distinctive its voice; the common majority (Response/Request/Path, 134k of
// the newly captured 204k) shares the driest one or it becomes a drone.
const CUE_FAMILY_BY_TYPE = {
  Advert: 'advert',
  GroupText: 'channel', GroupData: 'channel',
  TextMessage: 'message',
  Trace: 'trace',
}
export function cueFamily(packetType) {
  return CUE_FAMILY_BY_TYPE[packetType] || 'network'
}

// Minimum gap between cues of one family. Bursts still have to coalesce into
// distinct-but-sane audio; what changed is that the gap is no longer global.
export const CUE_GAP_MS = 60

// coalesceCue decides whether a cue is played, given when its family last
// sounded. Pure so the rule can be pinned, because the failure it prevents is
// invisible in the field: with two thirds of traffic audible, one global
// timestamp let a relayed cue swallow a zero-hop reception 30 ms behind it --
// the least important sound eating the most important one, in a hotspot, where
// it matters most.
//
// So: a direct cue is never held by a relayed one, a damped one yields to its
// own family AND to any direct cue inside the gap, and families do not shadow
// each other.
//
// Direct cues do yield to each other, across families (#470 review). Measured
// on the ingestor DB over 30 days, 39.2% of consecutive receptions per hunter
// share a timestamp to the millisecond and the groups run up to 40: a batch of
// BLE frames handled in one turn carries one rx_at. Without this branch all 40
// start at the same ac.currentTime and sum into a single loud transient, which
// is the failure this coalescer exists to prevent, inverted -- the burst eating
// itself rather than one family eating another. The gap is global here and not
// per family for the same reason: what sums is the instant, not the voice.
export function coalesceCue(state, cue, nowMs) {
  const st = state || {}
  if (!cue) return { play: false, state: st }
  if (!cue.damped) {
    if (nowMs - (st.direct ?? -Infinity) < CUE_GAP_MS) return { play: false, state: st }
    return { play: true, state: { ...st, [cue.family]: nowMs, direct: nowMs } }
  }
  const held = nowMs - (st[cue.family] ?? -Infinity) < CUE_GAP_MS ||
               nowMs - (st.direct ?? -Infinity) < CUE_GAP_MS
  if (held) return { play: false, state: st }
  return { play: true, state: { ...st, [cue.family]: nowMs } }
}

// ---------------------------------------------------------------------------
// Engine — owns the AudioContext, the soundbed, the generative music, and the
// voice envelopes.
// ---------------------------------------------------------------------------

// Per-family voice (#468). Everything is synthesised -- no assets, works
// offline -- so an "instrument" is an oscillator shape, an envelope and an
// optional consonant partial. `hold` and `tail` scale the RSSI-derived length;
// `partial` is a harmonic of the same fundamental (2 = octave, 3 = twelfth),
// so an added voice cannot clash with the note it thickens or with the music.
//
// These are starting points, to be dialled in by ear in the sound lab the way
// the mix was (#145, docs/2026-07-16-sound-modes.md). The structure is what
// this change fixes: prominence runs inverse to how common a family is, so the
// measured majority (network: Response/Request/Path) stays the driest thing in
// the mix and an Advert can afford a tail.
const VOICES = {
  advert:  { wave: 'sine',     hold: 1.0,  tail: 0.22, gain: 1.0,  partial: 3 },
  channel: { wave: 'triangle', hold: 0.85, tail: 0.10, gain: 0.95, partial: 0 },
  message: { wave: 'triangle', hold: 0.6,  tail: 0.05, gain: 0.75, partial: 0 },
  trace:   { wave: 'sine',     hold: 0.6,  tail: 0.14, gain: 0.8,  partial: 2 },
  network: { wave: 'sine',     hold: 0.35, tail: 0.02, gain: 0.5,  partial: 0 },
}

// A relayed reception is the same voice heard through something: lowpassed,
// shorter and quieter, so a direct reception stays the brightest thing in the
// mix and the ear can tell them apart without being told.
const DAMP_HZ = 900
const DAMP_GAIN = 0.65
const DAMP_HOLD = 0.7

// Reverb + music + rx mix, dialed in by ear in the sound lab (final round,
// 2026-07-16): morse-harmonic rx at 50%, music 86% @ 1.7×, reverb 35%/2.8 s.
const REVERB_WET = 0.35
const REVERB_SECONDS = 2.8
const MUSIC_GAIN = 0.86
const MUSIC_DENSITY = 1.7 // periods divided by this — how often notes fall
const RX_GAIN = 0.5       // reception dits, independent of the music/bed level
const FADE_S = 0.03       // music-bus fade before cutting voices, avoids a click

// Generative music (Eno's Music-for-Airports technique): seven pad voices,
// each looping ONE note of a calm F-pentatonic set on a mutually prime period.
// The periods share no common divisor, so the combination never repeats.
const GEN_NOTES = [174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 440.0] // F3 G3 A3 C4 D4 F4 A4
const GEN_PERIODS = [19, 23, 29, 31, 37, 41, 47] // seconds, mutually prime

export function createSoundEngine() {
  const AC = typeof AudioContext !== 'undefined' ? AudioContext
    : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null
  // No Web Audio (node tests, unsupported WebView) → inert engine, never throw.
  if (!AC) return { setMode() {}, cue() {}, txBlip() {}, destroy() {} }

  let ctx = null, mode = 'off', bed = null, cueState = {}
  let master = null, genTimers = [], genGain = null, activeOscs = []

  // Created lazily from the FAB tap (a user gesture, which Web Audio requires).
  // If the context comes back suspended anyway (persisted mode restored at boot,
  // before any gesture), a one-shot pointerdown listener resumes it on the first
  // tap anywhere.
  function ensureCtx() {
    if (!ctx) {
      ctx = new AC()
      // Master bus: gentle lowpass rounds every voice off — nothing shrill.
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6500
      const out = ctx.createGain()
      out.gain.value = 0.9
      lp.connect(out).connect(ctx.destination)
      master = lp
      // Reverb: synthesized impulse response (decaying noise), constant wet
      // send — part of the approved sound, not a runtime setting.
      const len = Math.floor(ctx.sampleRate * REVERB_SECONDS)
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
      }
      const convolver = ctx.createConvolver()
      convolver.buffer = ir
      const wet = ctx.createGain()
      wet.gain.value = REVERB_WET
      master.connect(wet).connect(convolver).connect(ctx.destination)
    }
    // Both recovery paths are armed here rather than in startMusic(), so the
    // rxtx mode — which never starts music, and is the one carrying the actual
    // signal information — gets them too.
    resumeOnVisibility()
    if (!ctx.onstatechange) {
      // iOS can interrupt without a visibilitychange (an in-call banner does not
      // background the page), so watch the context's own state as well.
      ctx.onstatechange = () => { if (ctx && ctx.state === 'interrupted') ctx.resume().catch(() => {}) }
    }
    const states = ['suspended', 'interrupted']
    if (states.includes(ctx.state)) {
      ctx.resume().catch(() => {})
      armGestureResume()
    }
    return ctx
  }

  // A suspended context's currentTime does not advance, so anything scheduled
  // against it lands at t=0 and every queued voice fires on the same sample the
  // moment it resumes. Nothing may be scheduled until the clock is actually
  // running; the audio is a live cue, so dropping what could not be played at
  // the time it referred to is the correct behaviour, not queueing it.
  const isRunning = () => !!ctx && ctx.state === 'running'

  // One pending gesture listener at a time. ensureCtx() runs per reception on
  // the ping path, so re-adding unconditionally stacks a listener per packet
  // while the context is suspended — hundreds over a call, all firing resume()
  // in the same gesture.
  let gestureArmed = false
  function armGestureResume() {
    if (gestureArmed) return
    gestureArmed = true
    const once = () => {
      gestureArmed = false
      document.removeEventListener('pointerdown', once)
      if (ctx) ctx.resume().catch(() => {})
    }
    document.addEventListener('pointerdown', once)
  }

  // Registered once for the life of the engine. startMusic() can run many
  // times (every entry into `full`), and re-adding here would stack a listener
  // per entry, each re-running resume() on the same context.
  //
  // Also owns the #260/#301 background behaviour: the normal bed+music (two
  // looped noise sources, two LFOs, seven note timers) cost real CPU/battery
  // for something that carries no information by design, so hidden swaps to
  // a single minimal held tone (startBgAmbience) instead of leaving them
  // idling in a pocket. A short cue marks each transition, a real event like
  // everything else this engine plays.
  let visibilityBound = false
  function resumeOnVisibility() {
    if (visibilityBound) return
    visibilityBound = true
    const handler = () => {
      if (document.hidden) {
        if (mode !== 'off') backgroundCue()
        if (mode === 'full') { stopBed(); stopMusic(); startBgAmbience() }
        return
      }
      // ctx.resume() is async: ctx.state stays 'suspended' until the promise
      // settles, and everything below is gated on isRunning() either directly
      // (resumeCue) or via scheduling against ctx.currentTime. Running them on
      // this same tick drops the resume cue on exactly the platforms #260 is
      // about — iOS Safari and Bluefy, the ones that actually suspend on hide.
      // It also hits at boot: a PWA launched with a persisted mode and no
      // gesture yet has a suspended context, so both cues would be lost and
      // startBed() would build against currentTime === 0.
      const wake = ctx && ['suspended', 'interrupted'].includes(ctx.state)
        ? ctx.resume().catch(() => {})
        : Promise.resolve()
      wake.then(() => {
        // Re-checked after the await: the user can hide the page again while
        // the resume is in flight, and mode can change under a slow resume.
        if (document.hidden) return
        if (mode !== 'off') resumeCue()
        if (mode === 'full') { stopBgAmbience(); startBed(); startMusic() }
      })
    }
    document.addEventListener('visibilitychange', handler)
  }

  // Looped noise buffer; `pink` (Paul Kellet approximation) for airy layers,
  // brown (integrated white) for the low surf rumble.
  function noiseBuffer(c, seconds, pink) {
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate)
    const data = buf.getChannelData(0)
    if (pink) {
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < data.length; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.997 * b0 + 0.0293 * w
        b1 = 0.985 * b1 + 0.0329 * w
        b2 = 0.95 * b2 + 0.0526 * w
        data[i] = (b0 + b1 + b2 + w * 0.05) * 0.6
      }
    } else {
      let last = 0
      for (let i = 0; i < data.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        data[i] = last * 3.5
      }
    }
    return buf
  }

  // Surf/air bed: distant surf (brown noise, lowpass, slow swell) + soft air
  // (pink noise, drifting bandpass). Two independent slow LFOs make it breathe
  // like a place, not hiss like a radio. Deliberately quiet — the real pings
  // must always stand out above it.
  function startBed() {
    if (bed) return
    const c = ensureCtx()
    const nodes = []
    const layer = (pink, filterType, freq, gainTarget, lfoHz, lfoDepth) => {
      const src = c.createBufferSource()
      src.buffer = noiseBuffer(c, 3, pink)
      src.loop = true
      const filter = c.createBiquadFilter()
      filter.type = filterType
      filter.frequency.value = freq
      if (filterType === 'bandpass') filter.Q.value = 0.7
      const gain = c.createGain()
      gain.gain.value = 0
      const lfo = c.createOscillator()
      const lfoGain = c.createGain()
      lfo.frequency.value = lfoHz
      lfoGain.gain.value = lfoDepth
      lfo.connect(lfoGain).connect(gain.gain)
      src.connect(filter).connect(gain).connect(master)
      src.start()
      lfo.start()
      // Fade in over a couple of seconds — no hard audio edge on mode flip.
      gain.gain.linearRampToValueAtTime(gainTarget, c.currentTime + 2)
      nodes.push({ src, gain, lfo })
    }
    layer(false, 'lowpass', 190, 0.05, 0.07, 0.02)   // distant surf swell
    layer(true, 'bandpass', 1100, 0.016, 0.11, 0.007) // soft moving air
    bed = nodes
  }

  // Backgrounding swaps to a dedicated, minimal ambience (#260/#301) rather
  // than ducking the normal bed in place: the bed+music are two looped noise
  // sources, two LFOs and seven note timers, all idling for no reason in a
  // pocket alongside BLE/GPS/MQTT — real cost for something that carries no
  // information by design. A single held tone (one oscillator, one LFO) reads
  // as "parked, not dead" for a fraction of the resource cost.
  const BG_TONE_HZ = 130.81 // C3 — sits below the music's own F-pentatonic register
  const BG_TONE_GAIN = 0.025
  let bgAmbience = null
  function startBgAmbience() {
    if (bgAmbience) return
    const c = ensureCtx()
    // Same guard every other voice on this path has. Without it: persisted
    // 'full' with no gesture yet means a suspended context at currentTime 0,
    // so the tone is started and ramped from t=0 while nothing is audible,
    // bgAmbience goes non-null (so the guard above then believes an ambience
    // is playing), and ensureCtx() has just armed a pointerdown listener while
    // the page is hidden. stopBgAmbience()'s ctx.currentTime + 0.4 is exposed
    // to the same frozen clock.
    if (!isRunning()) return
    const osc = c.createOscillator()
    const gain = c.createGain()
    const lfo = c.createOscillator()
    const lfoGain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = BG_TONE_HZ
    gain.gain.value = 0
    lfo.frequency.value = 0.08
    lfoGain.gain.value = BG_TONE_GAIN * 0.6
    lfo.connect(lfoGain).connect(gain.gain)
    osc.connect(gain).connect(master)
    osc.start()
    lfo.start()
    gain.gain.linearRampToValueAtTime(BG_TONE_GAIN, c.currentTime + 1.5)
    bgAmbience = { osc, gain, lfo }
  }
  function stopBgAmbience() {
    if (!bgAmbience) return
    const { osc, gain, lfo } = bgAmbience
    bgAmbience = null
    try {
      const now = ctx.currentTime
      // The fade-in ramp targets t0+1.5. Foregrounding inside that window
      // leaves it scheduled later in the timeline than this ramp-to-zero, and
      // per spec the param then climbs back up between the two events — the
      // tone swells instead of dying. Cancel and re-anchor at the current
      // value first. (Previously only the setTimeout below hid this, by
      // stopping the oscillator ~100ms later.)
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + 0.4)
      setTimeout(() => { try { osc.stop(); lfo.stop() } catch (_) {} }, 500)
    } catch (_) { try { osc.stop(); lfo.stop() } catch (_) {} }
  }

  function stopBed() {
    if (!bed) return
    const nodes = bed
    bed = null
    for (const { src, gain, lfo } of nodes) {
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6)
        setTimeout(() => { try { src.stop(); lfo.stop() } catch (_) {} }, 700)
      } catch (_) { try { src.stop(); lfo.stop() } catch (_) {} }
    }
  }

  // One generative pad note: slow swell, soft unison detune, quiet octave,
  // its own stereo position, gently lowpassed.
  function genNote(f, pan) {
    if (!isRunning()) return
    const c = ctx
    const t = c.currentTime, dur = 7 + Math.random() * 3, g = 0.05 + Math.random() * 0.02
    const out = c.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(g, t + dur * 0.35)
    out.gain.linearRampToValueAtTime(0, t + dur)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    let tail = out
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); tail = p }
    tail.connect(lp)
    lp.connect(genGain)
    for (const [mult, level] of [[1, 1], [1.003, 0.7], [2, 0.12]]) {
      const osc = c.createOscillator()
      const og = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = f * mult
      og.gain.value = level
      osc.connect(og).connect(out)
      osc.start(t)
      osc.stop(t + dur + 0.1)
      // Tracked so stopMusic can silence a note that is still sounding — a pad
      // runs 7-10 s, so clearing the timers alone leaves audio playing after
      // the user asked for silence. Untracked again on its own end, or `full`
      // mode would grow this array for as long as it plays.
      activeOscs.push(osc)
      osc.onended = () => {
        const i = activeOscs.indexOf(osc)
        if (i !== -1) activeOscs.splice(i, 1)
      }
    }
  }

  function startMusic() {
    if (genTimers.length) return
    const c = ensureCtx()
    resumeOnVisibility()
    if (!genGain) { genGain = c.createGain(); genGain.connect(master) }
    // Set every time, not just on creation: stopMusic() ramps this to zero to
    // avoid a click, so a later re-entry has to bring it back up.
    genGain.gain.cancelScheduledValues(c.currentTime)
    genGain.gain.setValueAtTime(MUSIC_GAIN, c.currentTime)
    GEN_NOTES.forEach((f, i) => {
      const pan = -0.6 + (i / (GEN_NOTES.length - 1)) * 1.2
      const period = (GEN_PERIODS[i] / MUSIC_DENSITY) * 1000
      const fire = () => {
        // Only fire if context is running (not suspended/interrupted)
        if (ctx && !['suspended', 'interrupted'].includes(ctx.state)) genNote(f, pan)
      }
      // random phase start so every session begins differently
      const t0 = setTimeout(() => { fire(); genTimers.push(setInterval(fire, period)) }, Math.random() * period)
      genTimers.push(t0)
    })
  }

  function stopMusic() {
    for (const t of genTimers) { clearTimeout(t); clearInterval(t) }
    genTimers = []
    // Pad notes run 7-10 s, so stopping the timers alone leaves them sounding —
    // "off" has to be off. Cutting the oscillators outright truncates them
    // mid-envelope though, and up to 21 simultaneous truncations through a 35%
    // reverb send is an audible click. Ramp the music bus down first, then stop
    // just after it reaches zero.
    const t = ctx?.currentTime ?? 0
    if (genGain && isRunning()) {
      genGain.gain.cancelScheduledValues(t)
      genGain.gain.setValueAtTime(genGain.gain.value, t)
      genGain.gain.linearRampToValueAtTime(0, t + FADE_S)
    }
    for (const osc of activeOscs) {
      try { osc.stop(t + FADE_S) } catch (_) {}
    }
    activeOscs = []
  }

  function setMode(m) {
    mode = m
    if (mode === 'off' || mode === 'rxtx') { stopBed(); stopMusic() }
    // The parked tone only belongs to 'full'. Both call sites are foreground-
    // only today, so leaving it out was unreachable rather than wrong — but it
    // made the invariant implicit, and a mode change while hidden would orphan
    // a tone with nothing left to stop it.
    if (mode !== 'full') stopBgAmbience()
    if (mode === 'off') return
    ensureCtx()
    if (mode === 'full' && !document.hidden) { startBed(); startMusic() }
  }

  // One cue per recorded reception (#468). The dit from #145's sound lab is
  // still the shape -- a tight CW attack, RSSI on the F harmonic series, hotter
  // = higher/longer/louder -- but the family chooses the instrument and a
  // relayed reception is damped rather than dropped.
  //
  // The caller decides WHETHER (receptionCue) and the coalescer decides whether
  // this one survives its burst; this function only plays what it is handed.
  function cue(c, rssi, offset = 0) {
    if (mode === 'off' || !c) return
    const { play, state } = coalesceCue(cueState, c, Date.now())
    cueState = state
    if (!play) return
    const ac = ensureCtx()
    if (!isRunning()) return
    const v = VOICES[c.family] || VOICES.network
    const f = harmFreq(rssi, offset)
    const frac = rssiFrac(rssi, offset)
    const g = pingGain(rssi, offset) * RX_GAIN * v.gain * (c.damped ? DAMP_GAIN : 1)
    const len = (0.035 + frac * 0.06) * v.hold * (c.damped ? DAMP_HOLD : 1)
    const t = ac.currentTime

    // One gain stage for the whole cue, so a partial cannot double the level.
    const og = ac.createGain()
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(g, t + 0.004)
    og.gain.setValueAtTime(g, t + len)
    og.gain.linearRampToValueAtTime(0.0001, t + len + v.tail)

    let out = og
    if (c.damped) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = DAMP_HZ
      og.connect(lp)
      out = lp
    }
    out.connect(master)

    const stop = t + len + v.tail + 0.04
    const voices = [f]
    if (v.partial) voices.push(f * v.partial)
    for (let i = 0; i < voices.length; i++) {
      const osc = ac.createOscillator()
      osc.type = v.wave
      osc.frequency.value = voices[i]
      // The partial rides under the fundamental, or the bell reads as a
      // different (higher) note instead of a colour on this one.
      if (i === 0) osc.connect(og)
      else {
        const pg = ac.createGain()
        pg.gain.value = 0.35
        osc.connect(pg).connect(og)
      }
      osc.start(t)
      osc.stop(stop)
    }
  }

  // Transmit-side cue (#145 addendum): the audio twin of the Discover FAB's
  // visual pulse (#232). Bubble pops — a fast upward pitch flick — so "I sent
  // something" never sounds like "I heard something" (dit = heard, rising
  // pop = sent).
  //   discover — two quick rising pops (the broadcast going out)
  //   trace    — one higher pop per targeted repeater trace-ping
  function pop(c, f, when) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f * 0.55, when)
    osc.frequency.exponentialRampToValueAtTime(f, when + 0.05)
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(0.16, when + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16)
    osc.connect(gain).connect(master)
    osc.start(when)
    osc.stop(when + 0.2)
  }

  function txBlip(kind) {
    if (mode === 'off') return
    const c = ensureCtx()
    if (!isRunning()) return
    if (kind === 'discover') { pop(c, 620, c.currentTime); pop(c, 830, c.currentTime + 0.11) }
    else pop(c, 990, c.currentTime)
  }

  // Background/resume cue (#260): two plain sine notes, distinct in shape
  // from both the dit (a single pitched tone) and the tx pop (a fast upward
  // flick) so a visibility transition never reads as a reception or a
  // transmission. Backgrounded falls (G4->D4, going quiet); resumed rises
  // (D4->G4, waking up) — the mirror image of each other.
  function tone(c, f, when, dur) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(0.14, when + 0.015)
    gain.gain.setValueAtTime(0.14, when + dur - 0.02)
    gain.gain.linearRampToValueAtTime(0, when + dur)
    osc.connect(gain).connect(master)
    osc.start(when)
    osc.stop(when + dur + 0.02)
  }

  function backgroundCue() {
    if (!isRunning()) return
    const t = ctx.currentTime
    tone(ctx, 392, t, 0.11)         // G4
    tone(ctx, 293.66, t + 0.13, 0.11) // D4
  }

  function resumeCue() {
    if (!isRunning()) return
    const t = ctx.currentTime
    tone(ctx, 293.66, t, 0.11)      // D4
    tone(ctx, 392, t + 0.13, 0.11)  // G4
  }

  function destroy() {
    stopBed()
    stopMusic()
    stopBgAmbience()
    if (ctx) { try { ctx.close() } catch (_) {} ctx = null; master = null; genGain = null }
  }

  return { setMode, cue, txBlip, destroy }
}
