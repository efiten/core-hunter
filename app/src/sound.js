// Sound modes (#145): audio feedback while hunting, so you can drive/walk
// without watching the screen. Redefined 2026-07-15 — geiger mode dropped;
// sounds are ALWAYS real: every information-carrying sound corresponds to an
// actual event (a zero-hop reception or an outgoing ping), never synthesized
// ticking. Three states, cycled by the sound FAB (#255):
//   off  — silent (default)
//   rxtx — a morse dit per real zero-hop reception + the transmit pops, no
//          bed/music; pitch (F harmonic series) and length scale with RSSI
//          (hotter = higher/longer), same fixed dBm band as the HUD bar
//          (-115..-75, calibration/attenuator offset applied)
//   full — the surf/air soundbed + generative ambient music (Eno-style, never
//          repeats), with the rx/tx sounds on top. The bed/music carry no
//          information (atmosphere only), so the always-real rule holds.
// Everything is synthesized with Web Audio — no audio assets, works offline.
// The engine degrades to a no-op when Web Audio is unavailable (node tests,
// old WebViews), mirroring the huntmap stub pattern.
// Mix values (reverb wet/decay, music volume/density) were chosen by ear in
// the #145 sound lab — see docs/2026-07-16-sound-modes.md.

export const SOUND_MODES = ['off', 'rxtx', 'full']

export function nextSoundMode(mode) {
  // Unknown values (corrupt/legacy storage, e.g. the dropped 'geiger') count
  // as 'off', so the next tap lands on 'ping' — indexOf's -1 does that for free.
  const i = SOUND_MODES.indexOf(mode)
  return SOUND_MODES[(Math.max(i, 0) + 1) % SOUND_MODES.length]
}

// Same band as the HUD's rssiToPct: weak -115 dBm .. strong -75 dBm. `offset`
// is the plot offset (calibration + attenuator), so a ping "sounds as hot" as
// the reception looks on the map/HUD.
const WEAK = -115
const STRONG = -75
function rssiFrac(rssi, offset = 0) {
  if (rssi == null) return 0
  const calibrated = rssi + offset
  return (Math.max(WEAK, Math.min(STRONG, calibrated)) - WEAK) / (STRONG - WEAK)
}

// RSSI → ping pitch on the HARMONIC SERIES of F2 (87.31 Hz), consonant
// overtones only: F4 A4 C5 F5 G5 A5 C6. The generative music plays in
// F-pentatonic, and overtones of F physically cannot clash with it — that was
// the fix for the first pentatonic attempt, a kalimba tuned to G, which fought
// the music. Hotter signal = higher harmonic.
const HARM_ROOT_HZ = 87.31 // F2
const HARMONICS = [4, 5, 6, 8, 9, 10, 12]
export function harmFreq(rssi, offset = 0) {
  return HARM_ROOT_HZ * HARMONICS[Math.round(rssiFrac(rssi, offset) * (HARMONICS.length - 1))]
}

// Ping loudness: 0.25 (weak) → 0.65 (strong) — never fully silent, with
// headroom over the soundbed and music.
export function pingGain(rssi, offset = 0) {
  return 0.25 + rssiFrac(rssi, offset) * 0.4
}

// The gate for reception pings: sound on, heard DIRECTLY (hops === 0 — a
// relayed packet's RSSI describes the last repeater, not the target), and
// inside the active filter set — you hear exactly what the map plots.
export function shouldPing(rec, mode, filterFn, nowMs) {
  if (mode === 'off') return false
  if (!rec || rec.hops !== 0) return false
  return !!filterFn(rec, nowMs)
}

// ---------------------------------------------------------------------------
// Engine — owns the AudioContext, the soundbed, the generative music, and the
// voice envelopes.
// ---------------------------------------------------------------------------

const MIN_PING_GAP_MS = 60 // coalesce reception bursts into distinct-but-sane audio

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
  if (!AC) return { setMode() {}, ping() {}, txBlip() {}, destroy() {} }

  let ctx = null, mode = 'off', bed = null, lastPingAt = 0
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
  // Also owns the #260 background behaviour: backgrounding while a sound mode
  // is active must be audible, not just silently full-volume in a pocket —
  // the generative music layer stops (duckBed keeps the bed itself breathing,
  // just quieter, rather than a hard stop) and a short cue marks each
  // transition, a real event like everything else this engine plays.
  let visibilityBound = false
  function resumeOnVisibility() {
    if (visibilityBound) return
    visibilityBound = true
    const handler = () => {
      if (document.hidden) {
        if (mode !== 'off') backgroundCue()
        if (mode === 'full') { stopMusic(); duckBed() }
        return
      }
      if (ctx && ['suspended', 'interrupted'].includes(ctx.state)) {
        ctx.resume().catch(() => {})
      }
      if (mode !== 'off') resumeCue()
      if (mode === 'full') { unduckBed(); startMusic() }
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
      nodes.push({ src, gain, lfo, gainTarget })
    }
    layer(false, 'lowpass', 190, 0.05, 0.07, 0.02)   // distant surf swell
    layer(true, 'bandpass', 1100, 0.016, 0.11, 0.007) // soft moving air
    bed = nodes
  }

  // Backgrounding (#260) ducks the bed rather than stopping it — a very low
  // bed keeps breathing so the app still reads as alive while multitasking,
  // just audibly different, unlike stopBed()'s hard fade-and-stop for a real
  // mode change.
  const BED_DUCK_FACTOR = 0.3
  let bedDucked = false
  function duckBed() {
    if (!bed || bedDucked) return
    bedDucked = true
    const t = ctx.currentTime
    for (const { gain, gainTarget } of bed) {
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(gainTarget * BED_DUCK_FACTOR, t + 1.5)
    }
  }
  function unduckBed() {
    if (!bed || !bedDucked) return
    bedDucked = false
    const t = ctx.currentTime
    for (const { gain, gainTarget } of bed) {
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(gainTarget, t + 1.5)
    }
  }

  function stopBed() {
    if (!bed) return
    const nodes = bed
    bed = null
    bedDucked = false
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
    if (mode === 'off') return
    ensureCtx()
    if (mode === 'full') { startBed(); startMusic() }
  }

  // Morse dit per real zero-hop reception (#145 sound lab winner, round 6):
  // a tight CW dit — 4 ms attack, 35..95 ms hold, 12 ms release — pitched on
  // the F harmonic series (harmFreq), so it locks into the generative music
  // instead of clashing with it. Hotter = higher harmonic, longer dit, louder.
  function ping(rssi, offset = 0) {
    if (mode === 'off') return
    const now = Date.now()
    if (now - lastPingAt < MIN_PING_GAP_MS) return
    lastPingAt = now
    const c = ensureCtx()
    if (!isRunning()) return
    const f = harmFreq(rssi, offset)
    const g = pingGain(rssi, offset) * RX_GAIN
    const len = 0.035 + rssiFrac(rssi, offset) * 0.06
    const t = c.currentTime
    const osc = c.createOscillator()
    const og = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(g, t + 0.004)
    og.gain.setValueAtTime(g, t + len)
    og.gain.linearRampToValueAtTime(0.0001, t + len + 0.012)
    osc.connect(og).connect(master)
    osc.start(t)
    osc.stop(t + len + 0.04)
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

  return { setMode, ping, txBlip, destroy }
}
