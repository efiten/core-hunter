import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSoundEngine } from '../sound.js'

// The engine was entirely untested: vitest runs in node, so `AudioContext` is
// undefined and createSoundEngine() returns its no-op stub — every real branch
// executed zero times. That is why three lifecycle defects shipped. A minimal
// fake context is enough to reach all of it; sound.js only needs the node
// factories, and only `document.addEventListener` off the DOM.

// `calls` records every ramp/set call made on this param -- used by the
// background-duck tests (#260) to check a ramp target without modelling the
// actual audio-rate value.
function fakeParam(value = 0) {
  const p = { value, calls: [] }
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) {
    p[m] = (...args) => { p.calls.push([m, ...args]); return p }
  }
  return p
}

function makeCtx({ state = 'running', sampleRate = 48000 } = {}) {
  const oscillators = []
  const gains = []
  const node = (extra = {}) => ({ connect(t) { return t }, ...extra })
  const ctx = {
    state,
    currentTime: 0,
    sampleRate,
    destination: node(),
    resumeCalls: 0,
    oscillators,
    gains,
    // Autoplay policy: before a user gesture, resume() does not actually start
    // the clock. Modelling that is the point -- a fake that always succeeds
    // cannot exercise the suspended path at all.
    gestureGiven: state === 'running',
    resume() {
      this.resumeCalls++
      if (this.gestureGiven) this.state = 'running'
      return Promise.resolve()
    },
    close() {},
    createGain: () => { const g = node({ gain: fakeParam(1) }); gains.push(g); return g },
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
    e.ping(-80)
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
    for (let i = 0; i < 50; i++) { vi.advanceTimersByTime(100); e.ping(-80) }
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
    e.ping(-80)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('arms at most one pending gesture listener however many receptions arrive', () => {
    ctx.state = 'suspended'; ctx.gestureGiven = false
    const e = createSoundEngine()
    e.setMode('rxtx')
    for (let i = 0; i < 40; i++) { vi.advanceTimersByTime(100); e.ping(-80) }
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

// #260: backgrounding while a sound mode is active must be audible — the
// generative music layer stops (ducked), the bed keeps breathing (not
// stopped outright) at a lower level, and a short cue marks each transition
// so background/foreground is a real event like everything else this engine
// plays, never silent state nobody notices.
function fireVisibility(hidden) {
  document.hidden = hidden
  listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn())
}

describe('backgrounding ducks the music and cues the transition (#260)', () => {
  it('stops the generative music while hidden, in full mode', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    vi.advanceTimersByTime(60_000)
    const before = ctx.oscillators.filter((o) => o.started && !o.stopped).length
    expect(before).toBeGreaterThan(0)

    fireVisibility(true)
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    // No new generative notes fire while hidden -- the timers were torn down.
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(0)
  })

  it('resumes the generative music once visible again, in full mode', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    fireVisibility(true)
    fireVisibility(false)
    ctx.oscillators.length = 0
    vi.advanceTimersByTime(60_000)
    expect(ctx.oscillators.filter((o) => o.started).length).toBeGreaterThan(0)
  })

  it('does not stop the bed outright while hidden -- it ducks, not silences', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    const bedSources = ctx.oscillators.slice() // bed LFOs, started at setMode('full')
    fireVisibility(true)
    // The bed's own oscillators (LFOs) are still the ones from startBed() --
    // none of them got .stop() called by ducking.
    expect(bedSources.every((o) => !o.stopped)).toBe(true)
  })

  it('ducks the bed gain lower while hidden and restores it on return', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('full')
    const bedGainCallsBefore = ctx.gains.reduce((n, g) => n + g.gain.calls.length, 0)
    fireVisibility(true)
    const bedGainCallsHidden = ctx.gains.reduce((n, g) => n + g.gain.calls.length, 0)
    expect(bedGainCallsHidden).toBeGreaterThan(bedGainCallsBefore)
    fireVisibility(false)
    const bedGainCallsVisible = ctx.gains.reduce((n, g) => n + g.gain.calls.length, 0)
    expect(bedGainCallsVisible).toBeGreaterThan(bedGainCallsHidden)
  })

  it('plays a cue on hidden and on resume, distinct from the bed/music', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('rxtx') // no bed/music at all -- isolates the cue itself
    ctx.oscillators.length = 0
    fireVisibility(true)
    const hiddenCue = ctx.oscillators.filter((o) => o.started).length
    expect(hiddenCue).toBeGreaterThan(0)
    ctx.oscillators.length = 0
    fireVisibility(false)
    const resumeCue = ctx.oscillators.filter((o) => o.started).length
    expect(resumeCue).toBeGreaterThan(0)
  })

  it('plays no cue and no duck when sound is off', () => {
    ctx.gestureGiven = true
    const e = createSoundEngine()
    e.setMode('off')
    ctx.oscillators.length = 0
    fireVisibility(true)
    fireVisibility(false)
    expect(ctx.oscillators).toHaveLength(0)
  })
})
