import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createFloatReadout, floatModel, floatSupported } from '../floatreadout.js'
import { senderReadout } from '../hudsender.js'

const rec = { sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: 'alpha', rssi: -85, snr: 8.5 }
const base = { rec, sinceText: '12s', mode: 'filtered', hidden: 0, ble: true, mqtt: true }

describe('floatModel — what the float readout draws', () => {
  it('carries the reception the way the HUD shows it', () => {
    const m = floatModel(base)
    expect(m.rssi).toBe('-85')
    expect(m.snr).toBe('SNR 8.5 dB')
    expect(m.since).toBe('12s')
    expect(m.who).toBe('alpha')
    expect(m.tier).toBe('warm')
  })
  // The same rule the HUD follows: a 1-byte hash is an id unless it is placed
  // on a node by reach (#661).
  it('goes through senderReadout, so a hash id stays marked as one', () => {
    const m = floatModel({ ...base, rec: { ...rec, sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' } })
    expect(m.who).toBe('#4a')
  })
  it('draws placeholders before the first reception', () => {
    const m = floatModel({ ...base, rec: null, sinceText: '—' })
    expect(m.rssi).toBe('—')
    expect(m.snr).toBe('SNR —')
    // The HUD's own empty sender line, until the float gets its own empty state.
    expect(m.who).toBe(senderReadout(null).text)
    expect(m.tier).toBe('none')
  })
  it('names the stand, and marks the eye only while filtered mode hid something', () => {
    expect(floatModel(base).stand).toBe('FILTERED')
    expect(floatModel(base).eye).toBe(false)
    expect(floatModel({ ...base, hidden: 2 }).eye).toBe(true)
    expect(floatModel({ ...base, mode: 'all', hidden: 2 }).stand).toBe('ALL')
    expect(floatModel({ ...base, mode: 'all', hidden: 2 }).eye).toBe(false)
  })
  // A frozen number in a floating window reads as "quiet", so the window has
  // to say when the radio is gone. The two dots are the topbar's, verbatim.
  it('reports the link state, and says Disconnected when BLE is gone', () => {
    expect(floatModel(base).dots).toEqual({ ble: true, mqtt: true })
    expect(floatModel(base).warning).toBe('')
    const m = floatModel({ ...base, ble: false, mqtt: false })
    expect(m.dots).toEqual({ ble: false, mqtt: false })
    expect(m.warning).toBe('Disconnected')
  })
  // The attenuator offset shifts the tier the same way the map and the HUD
  // shift it, so the window's colour agrees with both.
  it('applies the plot offset to the tier', () => {
    expect(floatModel({ ...base, offsetDb: 20 }).tier).toBe('hot')
  })
})

describe('floatSupported', () => {
  const win = (over) => ({
    document: { pictureInPictureEnabled: true },
    HTMLCanvasElement: { prototype: { captureStream() {} } },
    HTMLVideoElement: { prototype: { requestFullscreen() {}, requestPictureInPicture() {} } },
    ...over,
  })
  it('is true when a canvas can stream and a video can go fullscreen or float', () => {
    expect(floatSupported(win())).toBe(true)
  })
  it('is false without canvas capture', () => {
    expect(floatSupported(win({ HTMLCanvasElement: { prototype: {} } }))).toBe(false)
  })
  // iOS Safari has neither video PiP from a stream nor element fullscreen on
  // a video, but webkitEnterFullscreen: still a way to show the readout big.
  it('accepts webkitEnterFullscreen as the fullscreen path', () => {
    expect(floatSupported(win({ HTMLVideoElement: { prototype: { webkitEnterFullscreen() {} } } }))).toBe(true)
  })
  it('is false when the video has no way to leave the page', () => {
    expect(floatSupported(win({ HTMLVideoElement: { prototype: {} } }))).toBe(false)
  })
  it('is false with no window at all', () => {
    expect(floatSupported(undefined)).toBe(false)
  })
  // Android Chrome's video has requestPictureInPicture, but the document
  // says the API is off (#616): that alone is no way out of the page.
  it('is false when picture-in-picture is the only path and it is disabled', () => {
    expect(floatSupported(win({
      document: { pictureInPictureEnabled: false },
      HTMLVideoElement: { prototype: { requestPictureInPicture() {} } },
    }))).toBe(false)
  })
})

// A promise the test settles by hand. Every window request below is one, on
// purpose: a fake that resolves at once hides the ordering under test
// (AGENTS.md 5.1).
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Lets every promise continuation that is already due run, without timers,
// so it also works under vi.useFakeTimers.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

// The float readout against fakes of the canvas, the video, its document and
// screen.orientation. `calls` is one ordered log: the window requests, play
// and pause, the lock, and every text the canvas drew ('draw -85').
function makeFloat({ pip = true, fullscreen = true, webkit = false } = {}) {
  const calls = []
  const pending = {}
  const ask = (name) => {
    calls.push(name)
    const d = deferred()
    ;(pending[name] ||= []).push(d)
    return d.promise
  }
  const listeners = { doc: {}, video: {} }
  const on = (who) => (type, fn) => { (listeners[who][type] ||= []).push(fn) }
  const doc = {
    pictureInPictureEnabled: pip,
    fullscreenElement: null,
    pictureInPictureElement: null,
    addEventListener: on('doc'),
    exitFullscreen: async () => { calls.push('exitFullscreen') },
    exitPictureInPicture: async () => { calls.push('exitPictureInPicture') },
  }
  const video = {
    ownerDocument: doc,
    addEventListener: on('video'),
    play: async () => { calls.push('play') },
    pause: () => { calls.push('pause') },
    requestPictureInPicture: () => ask('requestPictureInPicture'),
  }
  if (fullscreen) video.requestFullscreen = () => ask('requestFullscreen')
  if (webkit) video.webkitEnterFullscreen = () => { calls.push('webkitEnterFullscreen') }
  // A 2D context that takes any drawing call; only the text is recorded.
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'fillText') return (text) => { calls.push('draw ' + text) }
      if (key === 'measureText') return (text) => ({ width: String(text).length * 10 })
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
      return () => {}
    },
    set(target, key, value) { target[key] = value; return true },
  })
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    captureStream: () => ({ getVideoTracks: () => [{ requestFrame() {} }] }),
  }
  const orientation = { lock: (o) => ask('lock ' + o), unlock: () => { calls.push('unlock') } }
  const next = (name) => {
    if (!pending[name] || !pending[name].length) throw new Error('nothing asked for ' + name + '; calls: ' + calls.join(', '))
    return pending[name].shift()
  }
  const opened = []
  const float = createFloatReadout({ canvas, video, colors: () => '#000000', onChange: (v) => opened.push(v), orientation })
  return {
    float, calls, opened, doc, video,
    count: (name) => calls.filter((c) => c === name).length,
    resolve: (name) => next(name).resolve(),
    reject: (name) => next(name).reject(new Error(name + ' refused')),
    fire: (type) => (listeners.doc[type] || []).forEach((fn) => fn()),
  }
}

// #616: the button promises a floating window. Picture-in-picture is that
// window, so it is asked for first; fullscreen is the fallback Android Chrome
// needs (its video PiP API is off), and it stays upright.
describe('createFloatReadout open path (#616)', () => {
  afterEach(() => { vi.useRealTimers() })

  // Up to the window request, then through the fullscreen step to open.
  async function openFullscreen(h) {
    h.float.open()
    await settle()
    h.doc.fullscreenElement = h.video
    h.resolve('requestFullscreen')
    await settle()
    h.resolve('lock portrait')
    await settle()
  }

  it('asks for picture-in-picture first where the browser has it enabled', async () => {
    const h = makeFloat()
    h.float.open()
    await settle()
    expect(h.count('requestPictureInPicture')).toBe(1)
    expect(h.count('requestFullscreen')).toBe(0)
    expect(h.float.isOpen()).toBe(false)
    h.resolve('requestPictureInPicture')
    await settle()
    expect(h.float.isOpen()).toBe(true)
    expect(h.opened).toEqual([true])
  })

  it('goes fullscreen when picture-in-picture is disabled, and locks portrait only once fullscreen is up', async () => {
    const h = makeFloat({ pip: false })
    h.float.open()
    await settle()
    expect(h.count('requestPictureInPicture')).toBe(0)
    expect(h.count('requestFullscreen')).toBe(1)
    expect(h.calls.some((c) => c.startsWith('lock'))).toBe(false)
    h.doc.fullscreenElement = h.video
    h.resolve('requestFullscreen')
    await settle()
    expect(h.count('lock portrait')).toBe(1)
    h.resolve('lock portrait')
    await settle()
    expect(h.float.isOpen()).toBe(true)
  })

  it('falls back to fullscreen when picture-in-picture is refused', async () => {
    const h = makeFloat()
    h.float.open()
    await settle()
    h.reject('requestPictureInPicture')
    await settle()
    expect(h.count('requestFullscreen')).toBe(1)
    expect(h.float.isOpen()).toBe(false)
    h.resolve('requestFullscreen')
    await settle()
    h.resolve('lock portrait')
    await settle()
    expect(h.float.isOpen()).toBe(true)
  })

  // iOS has no orientation lock, and a desktop browser refuses one: the
  // readout is out either way.
  it('still opens when the orientation lock is refused', async () => {
    const h = makeFloat({ pip: false })
    h.float.open()
    await settle()
    h.resolve('requestFullscreen')
    await settle()
    h.reject('lock portrait')
    await settle()
    expect(h.float.isOpen()).toBe(true)
    expect(h.opened).toEqual([true])
  })

  // iPhone Safari: no element fullscreen, only the video's own player.
  it('uses webkitEnterFullscreen where that is the only way out', async () => {
    const h = makeFloat({ pip: false, fullscreen: false, webkit: true })
    h.float.open()
    await settle()
    expect(h.count('webkitEnterFullscreen')).toBe(1)
    expect(h.float.isOpen()).toBe(true)
  })

  it('does not report open when every path failed', async () => {
    const h = makeFloat()
    const done = h.float.open()
    await settle()
    h.reject('requestPictureInPicture')
    await settle()
    h.reject('requestFullscreen')
    await expect(done).resolves.toBeUndefined()
    expect(h.float.isOpen()).toBe(false)
    expect(h.opened).not.toContain(true)
    expect(h.calls.at(-1)).toBe('pause')
  })

  it('unlocks the orientation as soon as fullscreen ends', async () => {
    vi.useFakeTimers()
    const h = makeFloat({ pip: false })
    await openFullscreen(h)
    expect(h.count('unlock')).toBe(0)
    h.doc.fullscreenElement = null
    h.fire('fullscreenchange')
    expect(h.count('unlock')).toBe(1)
  })

  // Android hands a fullscreen video to its floating window in two steps:
  // fullscreen ends, and pictureInPictureElement is set a moment later. The
  // check waits for that instead of reading the gap as a close.
  it('keeps the window open through the fullscreen-to-window hand-over', async () => {
    vi.useFakeTimers()
    const h = makeFloat({ pip: false })
    await openFullscreen(h)
    h.doc.fullscreenElement = null
    h.fire('fullscreenchange')
    await vi.advanceTimersByTimeAsync(400)
    h.doc.pictureInPictureElement = h.video
    await vi.advanceTimersByTimeAsync(700)
    expect(h.float.isOpen()).toBe(true)
    expect(h.count('pause')).toBe(0)
  })

  // The window shows its first frame the moment it opens, so that frame has
  // to be the reading the HUD shows, not the placeholders.
  it('draws the given reading before asking for a window', async () => {
    const h = makeFloat()
    h.float.open(floatModel(base))
    await settle()
    const drew = h.calls.indexOf('draw -85')
    expect(drew).toBeGreaterThanOrEqual(0)
    expect(drew).toBeLessThan(h.calls.indexOf('requestPictureInPicture'))
  })

  it('starts one open at a time', async () => {
    const h = makeFloat()
    h.float.open()
    h.float.open()
    await settle()
    expect(h.count('requestPictureInPicture')).toBe(1)
    expect(h.count('play')).toBe(1)
    h.resolve('requestPictureInPicture')
    await settle()
    await h.float.close()
    h.float.open()
    await settle()
    expect(h.count('requestPictureInPicture')).toBe(2)
  })
})

// The canvas is 4:3 and a phone screen is not, so fullscreen leaves bars above
// and below the reading. Those bars are the video element's own background, and
// they are as much a component colour as the reading itself: with a fixed value
// the light theme gets a dark frame around a light readout. app.css therefore
// declares the rule with --ch-bg, like every other colour in the file
// (AGENTS.md §7). The rule is CSS glue no unit test reaches, so it is pinned
// against the file, the way splash.test.js pins the FAB offsets.
describe('the fullscreen letterbox follows the theme (#555)', () => {
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
  const rule = css.split('}')
    .map((b) => b.split('{'))
    .find(([sel]) => sel?.includes('#float-video:fullscreen'))

  it('paints the bars with --ch-bg', () => {
    expect(rule, 'app.css declares #float-video:fullscreen').toBeTruthy()
    expect(rule[1]).toMatch(/background:\s*var\(--ch-bg\)/)
  })

  it('names no colour of its own', () => {
    expect(rule[1]).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })
})
