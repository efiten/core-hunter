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
//   full — a three-layer soundbed in its own reverb + generative ambient music
//          (Eno-style, never repeats, and since #496 the harmony drifts too),
//          with the rx/tx sounds on top. The bed/music carry no information
//          (atmosphere only), so the always-real rule holds.
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
// music plays in F (lydian since #496), and overtones of F physically cannot
// beat against it — that was the fix for the first attempt, a kalimba tuned to G,
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
// Dialled in by ear in the lab, 2026-08-25, from the starting points this PR
// opened with. What the round changed is separation: every family now differs
// in wave AND in attack, and three of them carry a short noise transient, so
// the ear reads the type from the first few milliseconds rather than from a
// tail it may never hear in traffic.
//
//   wave        oscillator shape -- the timbre
//   attack      seconds to full level; 1 ms reads as struck, 20 ms as blown
//   hold/tail   scale the RSSI-derived length, and the release after it
//   partial     harmonic added under the fundamental (2 = octave, 3 = twelfth)
//   noise       a band-passed noise burst in front of the tone, the "strike"
//
// Pitch is deliberately not in this table. It carries the signal strength and
// nothing else, which is the reading the instrument exists for (#468).
const VOICES = {
  advert:  { wave: 'sine',     hold: 1.4,  tail: 0.45, gain: 1.1,  partial: 3, partialGain: 0.5,  attack: 0.02,  noise: 0,    noiseLen: 0.01 },
  channel: { wave: 'triangle', hold: 0.9,  tail: 0.16, gain: 1.0,  partial: 2, partialGain: 0.25, attack: 0.004, noise: 0.25, noiseLen: 0.012 },
  message: { wave: 'square',   hold: 0.5,  tail: 0.06, gain: 0.8,  partial: 0, partialGain: 0.35, attack: 0.002, noise: 0.15, noiseLen: 0.008 },
  trace:   { wave: 'sawtooth', hold: 0.7,  tail: 0.2,  gain: 0.85, partial: 2, partialGain: 0.4,  attack: 0.001, noise: 0.1,  noiseLen: 0.006 },
  network: { wave: 'sine',     hold: 0.25, tail: 0.01, gain: 0.42, partial: 0, partialGain: 0.35, attack: 0.001, noise: 0.05, noiseLen: 0.004 },
}

// A relayed reception is not a quieter direct one: it is mostly what came back
// off the repeater. Only 15% of the strike survives; the rest of what you hear
// is a lowpassed echo, four taps 110 ms apart. Same lab round.
//
// Cheaper than it looks -- one delay node with a feedback loop, faded out after
// `taps` so the loop cannot ring on, and no pitch shift anywhere, so the RSSI
// reading survives the treatment.
const DAMP = { hz: 500, gain: 0.5, hold: 0.55, dry: 0.15, wet: 0.9, delayMs: 110, feedback: 0.45, taps: 4, echoHz: 900 }

// Reverb + music + rx mix, dialed in by ear in the sound lab (final round,
// 2026-07-16): morse-harmonic rx at 50%, music 86% @ 1.7×, reverb 35%/2.8 s.
const REVERB_WET = 0.35
const REVERB_SECONDS = 2.8
const MUSIC_GAIN = 0.86
const MUSIC_DENSITY = 1.5 // periods divided by this — how often notes fall
const RX_GAIN = 0.5       // reception dits, independent of the music/bed level
const FADE_S = 0.03       // music-bus fade before cutting voices, avoids a click

// Generative music (Eno's Music-for-Airports technique): seven pad voices,
// each looping ONE note of a calm F-pentatonic set on a mutually prime period.
// The periods share no common divisor, so the combination never repeats.
// F lydian rather than F pentatonic (#496): the pentatonic set is five notes
// and seven voices, so two voices always doubled and the harmony had nowhere to
// go. Lydian adds B and E, which is also what makes it drift-able -- there are
// enough notes that moving one voice changes the colour instead of the chord.
//
// The cue pitches are overtones of F2 and stay untouched, so the argument in
// harmFreq still holds for every one of them; B is the one note in this set
// that is not in that series, and it is the lydian colour, deliberately.
const GEN_SCALE = [174.61, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23] // F3 G3 A3 B3 C4 D4 E4 F4
// Three octaves of it. Ten voices out of eight notes would double two of them
// otherwise, and the low octave is what gives the bed something to sit on.
const GEN_NOTES = [...GEN_SCALE, ...GEN_SCALE.map((f) => f / 2), ...GEN_SCALE.map((f) => f * 2)]
const GEN_VOICES = 10
const GEN_PERIODS = [19, 23, 29, 31, 37, 41, 47, 53, 59, 61] // seconds, mutually prime
// Every DRIFT_SECONDS one voice moves to another note from the pool. This is
// what stops the music being the same seven notes an hour in: the combination
// of periods never repeated, but the material did.
const DRIFT_SECONDS = 150
const GEN_PAN_SPREAD = 0.9
const GEN_PAN_DRIFT = 0.35   // how far a note wanders while it sounds
const GEN_DUR = [6, 14]      // seconds
const GEN_GAIN = [0.035, 0.06]
const GEN_LOWPASS_HZ = 2400
const GEN_DETUNE = 0.005     // ratio of the second oscillator, the beating
const GEN_OCTAVE_LEVEL = 0.26

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
  // for something that carries no information by design, so hidden stops them
  // rather than leaving them idling in a pocket. A short cue marks each
  // transition, a real event like everything else this engine plays.
  //
  // Hidden used to swap in a held tone in their place ("parked, not dead").
  // Withdrawn by #568: with the bed gone there is nothing left to mask it, so
  // it was the loudest continuous thing in the mix while being the one voice
  // that carries no information — and the receptions, which do carry it, keep
  // sounding while hidden either way.
  let visibilityBound = false
  function resumeOnVisibility() {
    if (visibilityBound) return
    visibilityBound = true
    const handler = () => {
      if (document.hidden) {
        if (mode !== 'off') backgroundCue()
        if (mode === 'full') { stopBed(); stopMusic() }
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
        if (mode === 'full') { startBed(); startMusic() }
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
  // The ambient bed (#496), dialled by ear 2026-08-25. Three layers rather than
  // two, each with its own place in the stereo field and its own very slow pan
  // drift, feeding a reverb of their own: 8 seconds and darker than the master
  // one, so the bed sits in a bigger room than the cues do without smearing
  // them -- nothing but the bed is sent to it.
  //
  // The pan periods (0.009-0.021 Hz, i.e. 48-111 s) are deliberately slower
  // than anyone notices while driving. Nothing here should ever be catchable in
  // the act of moving; it should only be wider than it was a minute ago.
  const BED_LAYERS = [
    { pink: false, type: 'lowpass',  freq: 190,  q: 0.7, gain: 0.055, lfoHz: 0.07, lfoDepth: 0.03,  pan: -0.5, panDepth: 0.8, panHz: 0.013 },
    { pink: true,  type: 'bandpass', freq: 1100, q: 1.4, gain: 0.020, lfoHz: 0.11, lfoDepth: 0.012, pan: 0.6,  panDepth: 0.9, panHz: 0.021 },
    { pink: true,  type: 'bandpass', freq: 420,  q: 2.0, gain: 0.014, lfoHz: 0.05, lfoDepth: 0.008, pan: 0,    panDepth: 1.0, panHz: 0.009 },
  ]
  const BED_VERB = { wet: 0.35, seconds: 8, decay: 1.8, hz: 1600 }

  function startBed() {
    if (bed) return
    const c = ensureCtx()
    const nodes = []
    const len = Math.floor(c.sampleRate * BED_VERB.seconds)
    const ir = c.createBuffer(2, len, c.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, BED_VERB.decay)
    }
    const conv = c.createConvolver()
    conv.buffer = ir
    const verbLp = c.createBiquadFilter()
    verbLp.type = 'lowpass'
    verbLp.frequency.value = BED_VERB.hz
    const verbGain = c.createGain()
    verbGain.gain.value = BED_VERB.wet
    conv.connect(verbLp).connect(verbGain).connect(c.destination)

    for (const L of BED_LAYERS) {
      const src = c.createBufferSource()
      src.buffer = noiseBuffer(c, 3, L.pink)
      src.loop = true
      const filter = c.createBiquadFilter()
      filter.type = L.type
      filter.frequency.value = L.freq
      filter.Q.value = L.q
      const gain = c.createGain()
      gain.gain.value = 0
      const lfo = c.createOscillator()
      const lfoGain = c.createGain()
      lfo.frequency.value = L.lfoHz
      lfoGain.gain.value = L.lfoDepth
      lfo.connect(lfoGain).connect(gain.gain)
      const pan = c.createStereoPanner()
      pan.pan.value = L.pan
      const panLfo = c.createOscillator()
      const panGain = c.createGain()
      panLfo.frequency.value = L.panHz
      panGain.gain.value = L.panDepth
      panLfo.connect(panGain).connect(pan.pan)
      src.connect(filter).connect(gain).connect(pan)
      pan.connect(master)
      pan.connect(conv)
      src.start()
      lfo.start()
      panLfo.start()
      // Fade in over a couple of seconds — no hard audio edge on mode flip.
      gain.gain.linearRampToValueAtTime(L.gain, c.currentTime + 2)
      nodes.push({ src, gain, lfo, panLfo })
    }
    bed = nodes
  }

  function stopBed() {
    if (!bed) return
    const nodes = bed
    bed = null
    // panLfo as well as lfo (#496): an LFO nobody stops keeps a node graph alive
    // for the rest of the session, and there are now two per layer.
    for (const { src, gain, lfo, panLfo } of nodes) {
      const stopAll = () => { try { src.stop(); lfo.stop(); if (panLfo) panLfo.stop() } catch (_) {} }
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6)
        setTimeout(stopAll, 700)
      } catch (_) { stopAll() }
    }
  }

  // One generative pad note: slow swell, soft unison detune, quiet octave,
  // its own stereo position, gently lowpassed.
  function genNote(f, pan) {
    if (!isRunning()) return
    const c = ctx
    const t = c.currentTime
    const dur = GEN_DUR[0] + Math.random() * (GEN_DUR[1] - GEN_DUR[0])
    const g = GEN_GAIN[0] + Math.random() * (GEN_GAIN[1] - GEN_GAIN[0])
    const out = c.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(g, t + dur * 0.35)
    out.gain.linearRampToValueAtTime(0, t + dur)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = GEN_LOWPASS_HZ
    let tail = out
    if (c.createStereoPanner) {
      const p = c.createStereoPanner()
      p.pan.value = pan
      // The note wanders while it sounds, over its whole 6-14 s: slow enough
      // that it reads as space rather than as movement.
      p.pan.linearRampToValueAtTime(
        Math.max(-1, Math.min(1, pan + (Math.random() * 2 - 1) * GEN_PAN_DRIFT)), t + dur)
      out.connect(p)
      tail = p
    }
    tail.connect(lp)
    lp.connect(genGain)
    for (const [mult, level] of [[1, 1], [1 + GEN_DETUNE, 0.7], [2, GEN_OCTAVE_LEVEL]]) {
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
    // The voices hold their own note, so the drift timer below can move one
    // without disturbing the others' phase.
    const voices = []
    for (let i = 0; i < GEN_VOICES; i++) {
      voices.push({
        f: GEN_NOTES[i % GEN_NOTES.length],
        pan: -GEN_PAN_SPREAD + (i / (GEN_VOICES - 1)) * GEN_PAN_SPREAD * 2,
      })
    }
    voices.forEach((v, i) => {
      const period = (GEN_PERIODS[i % GEN_PERIODS.length] / MUSIC_DENSITY) * 1000
      const fire = () => {
        // Only fire if context is running (not suspended/interrupted)
        if (ctx && !['suspended', 'interrupted'].includes(ctx.state)) genNote(v.f, v.pan)
      }
      // random phase start so every session begins differently
      const t0 = setTimeout(() => { fire(); genTimers.push(setInterval(fire, period)) }, Math.random() * period)
      genTimers.push(t0)
    })
    // Harmony drift. Kept in genTimers so stopMusic() clears it with the rest.
    genTimers.push(setInterval(() => {
      const v = voices[Math.floor(Math.random() * voices.length)]
      v.f = GEN_NOTES[Math.floor(Math.random() * GEN_NOTES.length)]
    }, DRIFT_SECONDS * 1000))
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
    const g = pingGain(rssi, offset) * RX_GAIN * v.gain * (c.damped ? DAMP.gain : 1)
    const len = (0.035 + frac * 0.06) * v.hold * (c.damped ? DAMP.hold : 1)
    const t = ac.currentTime

    // One gain stage for the whole cue, so a partial cannot double the level.
    const og = ac.createGain()
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(g, t + v.attack)
    og.gain.setValueAtTime(g, t + len)
    og.gain.linearRampToValueAtTime(0.0001, t + len + v.tail)

    // Where anything else this cue adds has to land. On a relayed reception that
    // is the damped chain, not the master: a bright strike in front of an echo
    // reads as a direct reception with something odd after it.
    let sink = master
    if (c.damped) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = DAMP.hz
      og.connect(lp)
      // What is left of the strike itself.
      const dry = ac.createGain()
      dry.gain.value = DAMP.dry
      lp.connect(dry).connect(master)
      // And what came back off the repeater. The feedback loop is faded rather
      // than left to decay on its own: at 0.45 it is still audible after a
      // second, which would smear into the next reception in a hotspot.
      const delay = ac.createDelay(2)
      delay.delayTime.value = DAMP.delayMs / 1000
      const fb = ac.createGain()
      fb.gain.value = DAMP.feedback
      const eq = ac.createBiquadFilter()
      eq.type = 'lowpass'
      eq.frequency.value = DAMP.echoHz
      const wet = ac.createGain()
      wet.gain.value = DAMP.wet
      lp.connect(delay)
      delay.connect(eq).connect(fb).connect(delay)
      delay.connect(wet).connect(master)
      const life = (DAMP.delayMs / 1000) * DAMP.taps
      fb.gain.setValueAtTime(DAMP.feedback, t + life)
      fb.gain.linearRampToValueAtTime(0, t + life + 0.15)
      sink = lp
    } else {
      og.connect(master)
    }

    // The strike: a few milliseconds of band-passed noise in front of the tone.
    // It is what separates a struck voice from a blown one at the moment the
    // cue starts, which is the only part of a cue a busy minute leaves room for.
    if (v.noise > 0) {
      const n = Math.floor(ac.sampleRate * v.noiseLen)
      const buf = ac.createBuffer(1, n, ac.sampleRate)
      const ch = buf.getChannelData(0)
      for (let k = 0; k < n; k++) ch[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 3)
      const sn = ac.createBufferSource()
      sn.buffer = buf
      const ng = ac.createGain()
      ng.gain.value = g * v.noise
      const nf = ac.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = f * 2
      nf.Q.value = 0.7
      sn.connect(nf).connect(ng).connect(sink)
      sn.start(t)
    }

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
        pg.gain.value = v.partialGain
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
    if (ctx) { try { ctx.close() } catch (_) {} ctx = null; master = null; genGain = null }
  }

  return { setMode, cue, txBlip, destroy }
}
