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
  const node = (extra = {}) => ({ connect(t) { return t }, ...extra })
  const ctx = {
    state,
    currentTime: 0,
    sampleRate,
    destination: node(),
    resumeCalls: 0,
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
    createConvolver: () => node({ buffer: null }),
    createStereoPanner: () => node({ pan: fakeParam(0) }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node({ buffer: null, loop: false, start() {}, stop() {} }),
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
// note timers) stop outright and are replaced by a single minimal held tone,
// so nothing keeps idling in a pocket for atmosphere that carries no
// information. A short cue marks each transition so background/foreground is
// a real event like everything else this engine plays, never a silent state
// nobody notices.
// Async: the visible branch now waits on ctx.resume() before it cues or
// rebuilds anything, so a caller must let the microtask queue drain before
// asserting. Awaiting twice covers resume()'s own .then plus the engine's.
async function fireVisibility(hidden) {
  document.hidden = hidden
  listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn())
  await Promise.resolve()
  await Promise.resolve()
}

describe('backgrounding swaps to a minimal ambience and cues the transition (#260, #301)', () => {
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

  it('starts a single minimal ambience tone while hidden, in full mode', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    await fireVisibility(true)
    // The ambience is one held tone + its own LFO (2 oscillators) plus the
    // backgroundCue's own two notes (2 more) -- not the bed's two noise
    // sources and two LFOs (4), which would make this 6+.
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(4)
  })

  it('stops the ambience tone and restarts the normal bed on return', async () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    await fireVisibility(true)
    // Identify the ambience by its own pitch (C3). Slicing every oscillator
    // and asserting `some(stopped)` passed with the fix deleted: the slice
    // includes the two cue tones, and the fake marks an oscillator stopped as
    // soon as osc.stop(when) is called at creation -- so it was already true
    // before stopBgAmbience() ran at all.
    const tone = ctx.oscillators.find((o) => Math.abs(o.frequency.value - 130.81) < 0.01)
    expect(tone).toBeDefined()
    expect(tone.stopped).toBe(false)

    await fireVisibility(false)
    vi.advanceTimersByTime(1000) // stopBgAmbience()'s own fade-then-.stop() setTimeout
    expect(tone.stopped).toBe(true)

    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    // The bed (and its LFOs) started up again, distinct from the ambience.
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(2)
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

  // Blocker 2. startBgAmbience() was the one voice on this path with no
  // isRunning() guard. Persisted 'full' with no gesture yet means a suspended
  // context at currentTime 0: the tone gets started and ramped from t=0 while
  // nothing is audible, and bgAmbience goes non-null — so the early return at
  // the top then believes an ambience is playing and a later, real
  // backgrounding is silently skipped.
  it('starts no ambience tone while the context is still suspended', async () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('full')
    ctx.oscillators.length = 0
    await fireVisibility(true)
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('still starts the ambience on a later backgrounding once the clock is running', async () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('full')
    await fireVisibility(true)   // suspended: must not latch bgAmbience
    await fireVisibility(false)
    ctx.state = 'running'; ctx.gestureGiven = true
    ctx.oscillators.length = 0
    await fireVisibility(true)   // now it genuinely should play
    const tone = ctx.oscillators.find((o) => Math.abs(o.frequency.value - 130.81) < 0.01)
    expect(tone).toBeDefined()
    expect(tone.started).toBe(true)
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
