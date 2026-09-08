import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSoundEngine } from '../sound.js'

// A plain zero-hop cue: these tests are about the engine's clock and
// lifecycle, not about which instrument plays (#468).
const DIRECT = { family: 'network', damped: false }

// The engine was entirely untested: vitest runs in node, so `AudioContext` is
// undefined and createSoundEngine() returns its no-op stub — every real branch
// executed zero times. That is why three lifecycle defects shipped. A minimal
// fake context is enough to reach all of it; sound.js only needs the node
// factories, and only `document.addEventListener` off the DOM.

function fakeParam(value = 0) {
  return {
    value,
    setValueAtTime() { return this },
    linearRampToValueAtTime() { return this },
    exponentialRampToValueAtTime() { return this },
    cancelScheduledValues() { return this },
  }
}

function makeCtx({ state = 'running', sampleRate = 48000 } = {}) {
  const oscillators = []
  // `outs` makes the routing observable: some rules in sound.js are about where
  // a voice is sent, not whether it sounds, and a fake that forgets its wiring
  // cannot tell those apart.
  const node = (extra = {}) => ({ outs: [], connect(t) { this.outs.push(t); return t }, ...extra })
  const ctx = {
    state,
    currentTime: 0,
    sampleRate,
    destination: node(),
    resumeCalls: 0,
    delays: 0,
    bufferSources: 0,
    sources: [],
    panners: 0,
    convolvers: 0,
    oscillators,
    // Autoplay policy: before a user gesture, resume() does not actually start
    // the clock. Modelling that is the point -- a fake that always succeeds
    // cannot exercise the suspended path at all.
    gestureGiven: state === 'running',
    // Real resume() is async: state does not flip until the promise settles.
    // The fake used to flip it synchronously, which made every caller look
    // correctly ordered no matter when it read isRunning() — it hid a dropped
    // resume cue on exactly the platforms that suspend on hide. Flipping on a
    // microtask is the minimum needed to make the ordering observable.
    resume() {
      this.resumeCalls++
      const gestureGiven = this.gestureGiven
      return Promise.resolve().then(() => { if (gestureGiven) this.state = 'running' })
    },
    close() {},
    createGain: () => node({ gain: fakeParam(1) }),
    createBiquadFilter: () => node({ type: '', frequency: fakeParam(0), Q: fakeParam(0) }),
    createConvolver: () => { ctx.convolvers++; return node({ buffer: null }) },
    createStereoPanner: () => { ctx.panners++; return node({ pan: fakeParam(0) }) },
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => { ctx.bufferSources++; const n = node({ buffer: null, loop: false, start() {}, stop() {} }); ctx.sources.push(n); return n },
    createDelay: () => { ctx.delays++; return node({ delayTime: fakeParam(0) }) },
    createOscillator() {
      const o = node({
        type: 'sine', frequency: fakeParam(0),
        started: false, stopped: false, onended: null,
        start() { this.started = true },
        stop() { this.stopped = true },
      })
      oscillators.push(o)
      return o
    },
  }
  return ctx
}

let ctx
let listeners

beforeEach(() => {
  vi.useFakeTimers()
  listeners = []
  ctx = makeCtx()
  globalThis.AudioContext = function () { return ctx }
  globalThis.document = {
    hidden: false,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i !== -1) listeners.splice(i, 1)
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.AudioContext
  delete globalThis.document
})

const countListeners = (type) => listeners.filter((l) => l.type === type).length

describe('the engine is reachable at all', () => {
  it('builds a real engine once AudioContext exists, not the no-op stub', () => {
    const e = createSoundEngine()
    e.setMode('rxtx')
    e.cue(DIRECT, -80)
    expect(ctx.oscillators.length).toBeGreaterThan(0)
  })
})

// Blocker 1: a suspended context's clock does not advance, so notes scheduled
// against it all land at t≈0 and fire simultaneously the moment it resumes.
describe('music never schedules against a suspended clock (#145)', () => {
  it('creates no note voices while the context is suspended', () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false   // autoplay still blocked
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0          // ignore the bed's own sources
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('creates them once the context is running', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('treats an interrupted context the same — WebKit uses it for call/lock', () => {
    ctx.state = 'interrupted'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })
})

// The same clock problem on the rx/tx path, which is the one that actually
// matters: rxtx never starts the music, so the guard inside the note scheduler
// does not cover it, and setMode runs at DOMContentLoaded before any gesture.
describe('rx/tx cues never schedule against a suspended clock (#145)', () => {
  it('plays no dit while the context is suspended', () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('rxtx')
    ctx.oscillators.length = 0
    for (let i = 0; i < 50; i++) { vi.advanceTimersByTime(100); e.cue(DIRECT, -80) }
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('plays no transmit pop while the context is suspended', () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('rxtx')
    ctx.oscillators.length = 0
    e.txBlip('discover'); e.txBlip('trace')
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('plays them once the context is running', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('rxtx')
    ctx.oscillators.length = 0
    e.cue(DIRECT, -80)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('arms at most one pending gesture listener however many receptions arrive', () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('rxtx')
    for (let i = 0; i < 40; i++) { vi.advanceTimersByTime(100); e.cue(DIRECT, -80) }
    const pointer = listeners.filter((l) => l.type === 'pointerdown')
    expect(pointer).toHaveLength(1)
  })
})

// Blocker 3: pad notes run 7-10s, so clearing the timers alone leaves up to ten
// seconds of sound after the user has asked for silence one-handed while driving.
describe('stopMusic silences what is already sounding (#145)', () => {
  it('stops every voice still running', () => {
    const e = createSoundEngine()
    e.setMode('full')
    const bed = ctx.oscillators.length     // the bed's LFOs are oscillators too
    vi.advanceTimersByTime(60_000)
    const voices = ctx.oscillators.slice(bed).filter((o) => o.started)
    expect(voices.length).toBeGreaterThan(0)
    voices.forEach((o) => { o.stopped = false })   // clear the scheduled end
    e.setMode('off')
    expect(voices.every((o) => o.stopped)).toBe(true)
  })
})

// Blocker 2: only 'suspended' had a recovery path, and nothing re-checked on
// return from background, so an iOS interruption killed audio for the session.
describe('recovery from an interrupted or backgrounded context (#145)', () => {
  it('registers exactly one visibilitychange listener however often the mode cycles', () => {
    const e = createSoundEngine()
    e.setMode('full'); e.setMode('rxtx'); e.setMode('full'); e.setMode('off'); e.setMode('full')
    expect(countListeners('visibilitychange')).toBe(1)
  })

  it('resumes an interrupted context when the page becomes visible again', () => {
    const e = createSoundEngine()
    e.setMode('full')
    ctx.state = 'interrupted'
    const before = ctx.resumeCalls
    listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn())
    expect(ctx.resumeCalls).toBeGreaterThan(before)
  })
})

// Leak: every note pushed a voice onto the tracking array and nothing ever
// removed it, so `full` mode grew the array for as long as it played.
describe('finished voices are not retained (#145)', () => {
  it('drops a voice from tracking once it ends', () => {
    const e = createSoundEngine()
    e.setMode('full')
    const bed = ctx.oscillators.length
    vi.advanceTimersByTime(60_000)
    const voices = ctx.oscillators.slice(bed).filter((o) => o.started)
    expect(voices.length).toBeGreaterThan(0)
    // Every voice reports its own end, which is what lets the engine forget it.
    expect(voices.every((o) => typeof o.onended === 'function')).toBe(true)
    voices.forEach((o) => { o.onended(); o.stopped = false })
    e.setMode('off')
    // Nothing re-stops a voice that already ended.
    expect(voices.every((o) => o.stopped === false)).toBe(true)
  })
})

// #260/#301: backgrounding while a sound mode is active must be audible AND
// cheap — the normal bed+music (two looped noise sources, two LFOs, seven
// note timers) stop outright, so nothing keeps idling in a pocket for
// atmosphere that carries no information. A short cue marks each transition so
// background/foreground is a real event like everything else this engine
// plays, never a silent state nobody notices.
// #568 withdrew the held tone that used to stand in for the bed: with the bed
// gone nothing masked it, so the one voice carrying no information was the
// loudest continuous thing in the mix.
// Async: the visible branch now waits on ctx.resume() before it cues or
// rebuilds anything, so a caller must let the microtask queue drain before
// asserting. Awaiting twice covers resume()'s own .then plus the engine's.
async function fireVisibility(hidden) {
  document.hidden = hidden
  listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn())
  await Promise.resolve()
  await Promise.resolve()
}

describe('backgrounding stops the atmosphere and cues the transition (#260, #301, #568)', () => {
  // #568: the held tone that used to stand in for the bed is withdrawn. The
  // pocket is quiet apart from the transition cue and the receptions
  // themselves, which is what the cue count pins: two notes, nothing held.
  it('leaves nothing running while hidden — only the transition cue sounds', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    await fireVisibility(true)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(2)
  })

  it('stops the generative music while hidden, in full mode', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    vi.advanceTimersByTime(60_000)
    const before = ctx.oscillators.filter((o) => o.started && !o.stopped).length
    expect(before).toBeGreaterThan(0)

    await fireVisibility(true)
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    // No new generative notes fire while hidden -- the timers were torn down.
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('resumes the generative music once visible again, in full mode', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    await fireVisibility(true)
    // Prove the music is actually stopped first, otherwise "it plays after
    // returning" is satisfied by music that never stopped -- which is how this
    // test passed against master.
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)

    await fireVisibility(false)
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('stops the bed outright while hidden -- it is replaced, not ducked in place', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    const bedSources = ctx.oscillators.slice() // bed LFOs, started at setMode('full')
    await fireVisibility(true)
    vi.advanceTimersByTime(1000) // stopBed()'s own fade-then-.stop() setTimeout
    expect(bedSources.some((o) => o.stopped)).toBe(true)
  })

  it('restarts the bed itself on return, not only the music', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    await fireVisibility(true)
    vi.advanceTimersByTime(1000) // stopBed()'s own fade-then-.stop() setTimeout
    const loops = ctx.bufferSources
    await fireVisibility(false)
    // The bed is looped noise sources; the music is oscillators. Counting
    // oscillators cannot tell the two apart, so a return path that restarted
    // the music and forgot the bed would pass that assertion.
    expect(ctx.bufferSources).toBeGreaterThan(loops)
  })

  it('plays a cue on hidden and on resume, distinct from the bed/music', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('rxtx') // no bed/music at all -- isolates the cue itself
    ctx.oscillators.length = 0
    await fireVisibility(true)
    const hiddenCue = ctx.oscillators.filter((o) => o.started).length
    expect(hiddenCue).toBeGreaterThan(0)
    ctx.oscillators.length = 0
    await fireVisibility(false)
    const resumeCue = ctx.oscillators.filter((o) => o.started).length
    expect(resumeCue).toBeGreaterThan(0)
  })

  // Blocker 1. ctx.resume() is async, so on a platform that really suspends on
  // hide, ctx.state is still 'suspended' on the tick the handler runs. Every
  // cue is gated on isRunning(), so running them synchronously drops the
  // resume cue entirely -- silence on the way back in, which is the case #260
  // exists for. Only observable because the fake's resume() now settles on a
  // microtask rather than flipping state inline.
  it('still plays the resume cue when the context was genuinely suspended', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('rxtx')
    await fireVisibility(true)
    // What a backgrounded iOS/Bluefy context actually looks like on return.
    ctx.state = 'suspended'
    ctx.oscillators.length = 0
    await fireVisibility(false)
    expect(ctx.state).toBe('running')
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  // The hidden branch is not awaited, so it runs on a context that a PWA
  // launched with a persisted mode and no gesture yet leaves suspended at
  // currentTime 0. Nothing may be started or scheduled against that clock.
  it('starts nothing while the context is still suspended', async () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    await fireVisibility(true)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  // The other half of #301: parking the atmosphere must not park the signal.
  // Nothing gates ping() on visibility today, and this is what would catch a
  // later change that did.
  it('still plays a reception dit while hidden', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('rxtx')
    await fireVisibility(true)
    ctx.oscillators.length = 0
    e.cue(DIRECT, -80)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('plays no cue when sound is off', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    // setMode('off') returns before ensureCtx(), so a fresh engine has no
    // visibilitychange listener at all and firing one exercises nothing. Arm
    // the listener via 'full' first, then switch off -- that is the state the
    // mode !== 'off' guards are actually for.
    e.setMode('full')
    e.setMode('off')
    ctx.oscillators.length = 0
    await fireVisibility(true)
    await fireVisibility(false)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })
})

// Dialled in by ear in the sound lab, 2026-08-25. The point of the profile is
// that the families read apart at a glance-equivalent -- one strike and you
// know what kind of packet it was -- and that a relayed reception is not a
// quieter version of a direct one but a different event: mostly what came back
// off the repeater rather than the strike itself.
//
// Pitch is not part of any of it. It carries the signal strength, and that is
// the reading the whole instrument exists for (#468).
describe('the voice profile is audible in what the engine builds', () => {
  const DAMPED = { family: 'network', damped: true }

  it('routes a relayed cue through a delay line and a direct one straight out', () => {
    const e = createSoundEngine()
    e.setMode('rxtx')
    e.cue(DIRECT, -80)
    expect(ctx.delays, 'a direct cue has no echo').toBe(0)
    vi.advanceTimersByTime(100)
    e.cue(DAMPED, -80)
    expect(ctx.delays, 'a relayed cue is heard through its echo').toBe(1)
  })

  it('gives a family with a transient its noise burst, and one without none', () => {
    const e = createSoundEngine()
    e.setMode('rxtx')
    const before = ctx.bufferSources
    e.cue({ family: 'message', damped: false }, -80)   // noise > 0 in the profile
    const withClick = ctx.bufferSources - before
    vi.advanceTimersByTime(100)
    e.cue({ family: 'advert', damped: false }, -80)    // noise === 0
    expect(withClick, 'the message voice is struck').toBe(1)
    expect(ctx.bufferSources - before - withClick, 'the advert voice is not').toBe(0)
  })

  it('keeps every family distinguishable by wave and envelope, not by pitch', () => {
    // A profile where two families share a wave AND an envelope is one where
    // the ear cannot tell them apart, which is the whole point of #468. Pitch
    // is excluded on purpose: it is the RSSI reading.
    const e = createSoundEngine()
    e.setMode('rxtx')
    const shapes = new Set()
    for (const family of ['advert', 'channel', 'message', 'trace', 'network']) {
      const before = ctx.oscillators.length
      e.cue({ family, damped: false }, -80)
      const osc = ctx.oscillators.slice(before)
      expect(osc.length, `${family} sounds at all`).toBeGreaterThan(0)
      shapes.add(`${osc[0].type}/${osc.length}`)
      vi.advanceTimersByTime(100)
    }
    expect(shapes.size, 'families that sound identical').toBeGreaterThanOrEqual(4)
  })
})

// The strike is part of "heard through something" too. Routed straight to the
// master it stayed bright on a relayed reception, which put a crisp transient
// in front of an echo that is meant to sound like it came off a repeater --
// the one moment of the cue a busy minute actually leaves room for.
describe('a relayed strike is damped with the rest of the cue', () => {
  // Walks the graph from `start` and reports whether anything on the way is the
  // relayed lowpass. Depth-limited: the master bus feeds a reverb loop.
  const reaches = (start, hz, depth = 6) => {
    if (depth === 0) return false
    for (const out of start.outs || []) {
      if (out.frequency && out.frequency.value === hz) return true
      if (reaches(out, hz, depth - 1)) return true
    }
    return false
  }

  it('sends a relayed noise burst through the same lowpass as its tone', () => {
    const e = createSoundEngine()
    e.setMode('rxtx')
    const before = ctx.sources.length
    e.cue({ family: 'message', damped: true }, -80)
    const burst = ctx.sources[before]
    expect(burst, 'the message voice is struck').toBeTruthy()
    expect(reaches(burst, 500), 'the strike goes through the relayed lowpass').toBe(true)
  })

  it('leaves a direct strike alone', () => {
    const e = createSoundEngine()
    e.setMode('rxtx')
    const before = ctx.sources.length
    e.cue({ family: 'message', damped: false }, -80)
    expect(reaches(ctx.sources[before], 500), 'a direct strike is not damped').toBe(false)
  })
})

// The ambient layer of `full` (#496), dialled by ear 2026-08-25. Three things
// changed and each one is a resource the engine has to clean up again, which is
// the half of it that is not a matter of taste.
describe('the ambient layer has depth, and gives it all back', () => {
  it('builds three bed layers, each with a pan LFO, into a reverb of their own', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    const convolvers = ctx.convolvers
    e.setMode('full')
    // 3 noise loops, and 2 oscillators per layer (swell + pan).
    expect(ctx.bufferSources, 'one noise loop per bed layer').toBe(3)
    expect(ctx.panners, 'one panner per bed layer').toBe(3)
    expect(ctx.oscillators.filter((o) => o.started).length,
      'a swell and a pan LFO per layer').toBeGreaterThanOrEqual(6)
    // The master bus builds one convolver in ensureCtx; the bed adds its own.
    expect(ctx.convolvers - convolvers, 'the bed has a reverb the cues do not share').toBe(2)
  })

  it('stops every bed oscillator when the bed stops, pan LFOs included', () => {
    // An LFO nobody stops runs for the rest of the session. There are two per
    // layer now, and the second one was added by this change, so "the bed is
    // stopped" is no longer the same statement as "its swell LFO is stopped".
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    const bedOscs = ctx.oscillators.filter((o) => o.started)
    e.setMode('off')
    vi.advanceTimersByTime(1000)
    expect(bedOscs.every((o) => o.stopped), 'an LFO outlived the bed').toBe(true)
  })

  it('gives the music more voices than it has notes in one octave, and drifts them', () => {
    // Ten voices out of an eight-note scale is why the pool spans octaves: with
    // one octave two voices would sound the same note for the whole session.
    // The drift timer is what stops the set being fixed at all.
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    vi.advanceTimersByTime(120_000)   // every voice has fired by now
    const pitches = new Set(ctx.oscillators.filter((o) => o.started).map((o) => Math.round(o.frequency.value)))
    expect(pitches.size, 'the music repeats one handful of notes').toBeGreaterThan(8)
    const before = new Set(pitches)
    vi.advanceTimersByTime(600_000)   // four drift intervals
    const after = new Set(ctx.oscillators.filter((o) => o.started).map((o) => Math.round(o.frequency.value)))
    expect([...after].some((f) => !before.has(f)), 'the harmony never moved').toBe(true)
  })

})
