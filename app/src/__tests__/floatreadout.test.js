import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createFloatReadout, fitName, floatModel, floatSupported } from '../floatreadout.js'
import { senderReadout } from '../hudsender.js'
import { hudToggleText } from '../hudmode.js'

const rec = { sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: 'alpha', rssi: -85, snr: 8.5 }
const base = { rec, sinceText: '12s', mode: 'filtered', hidden: 0, ble: true, mqtt: true }

describe('floatModel: what the float readout draws', () => {
  it('carries the reception the way the HUD shows it', () => {
    const m = floatModel(base)
    expect(m.empty).toBe(false)
    expect(m.rssi).toBe('-85')
    expect(m.snr).toBe('SNR 8.5 dB')
    expect(m.since).toBe('12s')
    expect(m.tier).toBe('warm')
    const { prefix, name, note } = senderReadout(rec)
    expect(m.sender).toEqual({ prefix, name, note })
  })
  // The same rule the HUD follows: a 1-byte hash is an id unless it is placed
  // on a node by reach (#661).
  it('goes through senderReadout, so a hash id stays marked as one', () => {
    const m = floatModel({ ...base, rec: { ...rec, sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' } })
    expect(m.sender.name).toBe('#4a')
  })
  // A relay keeps its muted "via " apart from the name, so only the name is
  // ever cut (#637).
  it('keeps a relay\'s prefix apart from the name', () => {
    const relay = { ...rec, sender_kind: 'relay', sender_id: '64aa', sender_label: 'Dikkeboom' }
    const m = floatModel({ ...base, rec: relay })
    expect(m.sender.prefix).toBe(senderReadout(relay).prefix)
    expect(m.sender.prefix.startsWith('via ')).toBe(true)
    expect(m.sender.name).toBe(senderReadout(relay).name)
  })
  // No placeholder dashes: the window has its own empty state (#615).
  it('marks an empty window before the first reception', () => {
    const m = floatModel({ ...base, rec: null, sinceText: '' })
    expect(m.empty).toBe(true)
    expect(m.rssi).toBe('')
    expect(m.snr).toBe('')
    expect(m.since).toBe('')
    expect(m.tier).toBe('none')
    expect(floatModel({}).empty).toBe(true)
  })
  it('explains a reception without a sender the way the HUD does', () => {
    const trace = { rssi: -82, snr: 7.8, packet_type: 'Trace' }
    expect(floatModel({ ...base, rec: trace }).sender.note).toBe(senderReadout(trace).note)
    expect(floatModel({ ...base, rec: trace }).sender.note).not.toBe('')
  })
  it('names the stand in the HUD\'s words, and marks the eye only while filtered mode hid something', () => {
    for (const [mode, hidden] of [['filtered', 0], ['filtered', 2], ['all', 2]]) {
      const t = hudToggleText(mode, hidden)
      const m = floatModel({ ...base, mode, hidden })
      expect(m.stand, `${mode}/${hidden}`).toBe(t.label)
      expect(m.eye, `${mode}/${hidden}`).toBe(t.eye)
    }
    expect(floatModel({ ...base, hidden: 2 }).eye).toBe(true)
  })
  // A frozen number in a floating window reads as "quiet", so the window has
  // to say when the radio is gone, and names both links in words.
  it('names each link, and says Disconnected only when BLE is gone', () => {
    expect(floatModel(base).links).toEqual({ ble: true, mqtt: true })
    expect(floatModel(base).status).toBe('')
    expect(floatModel({ ...base, mqtt: false }).status).toBe('')
    const m = floatModel({ ...base, ble: false, mqtt: false })
    expect(m.links).toEqual({ ble: false, mqtt: false })
    expect(m.status).toBe('Disconnected')
  })
  // The arrow (#660) belongs to the reception it points from.
  it('passes the direction through only with a reception', () => {
    const dir = { angle: 40, kind: 'advertised' }
    expect(floatModel({ ...base, dir }).dir).toEqual(dir)
    expect(floatModel({ ...base }).dir).toBe(null)
    expect(floatModel({ ...base, rec: null, dir }).dir).toBe(null)
  })
  // The attenuator offset shifts the tier the same way the map and the HUD
  // shift it, so the window's colour agrees with both.
  it('applies the plot offset to the tier', () => {
    expect(floatModel({ ...base, offsetDb: 20 }).tier).toBe('hot')
  })
})

// The name is the one line whose length the app does not control, and names
// carry emoji (#637). A cut by UTF-16 unit split a surrogate pair into a
// replacement glyph; the cut goes by whole graphemes instead.
describe('fitName', () => {
  // Width by UTF-16 unit: an emoji is two units, so it costs twice a letter,
  // and half of one would fit where the whole does not. That is the cut a
  // grapheme-blind loop makes.
  const measure = (s) => s.length * 10
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  it('cuts a long name by whole graphemes and ends in an ellipsis', () => {
    const name = 'NL-NIJ-Dikkeboom \u{1F333} Dak'
    // 22 units, 220 wide: every width below that has to cut.
    for (let max = 60; max < 220; max += 10) {
      const out = fitName(name, max, measure)
      expect(out.endsWith('…'), `${max}: ${out}`).toBe(true)
      expect(loneSurrogate.test(out), `${max}: ${out}`).toBe(false)
      expect(measure(out)).toBeLessThanOrEqual(max)
    }
    expect(fitName(name, 200, measure)).toBe('NL-NIJ-Dikkeboom \u{1F333}…')
    expect(fitName(name, 190, measure)).toBe('NL-NIJ-Dikkeboom …')
  })
  it('leaves a name that fits untouched', () => {
    expect(fitName('Dikkeboom-RX', 500, measure)).toBe('Dikkeboom-RX')
  })
})

// The window hangs over other apps, often a dark navigation app, so it is
// dark whatever the app's theme (#615). That is done with the dark palette's
// own attribute on the elements, not a token of its own.
describe('the float readout is drawn in the dark palette (#615)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
  it('puts data-theme="dark" on the canvas and the video', () => {
    for (const id of ['float-canvas', 'float-video']) {
      const tag = html.match(new RegExp(`<(canvas|video)\\b[^>]*\\bid="${id}"[^>]*>`))
      expect(tag, `index.html has #${id}`).toBeTruthy()
      expect(tag[0], `#${id}`).toMatch(/\bdata-theme="dark"/)
    }
  })
  it('defines the dark palette on any element with that attribute, not only the root', () => {
    const selectors = tokens.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0])
    const dark = selectors.find((sel) => /--ch-bg/.test(tokens) && sel.split(',').map((x) => x.trim()).includes('[data-theme="dark"]'))
    expect(dark, 'tokens.css has a rule for [data-theme="dark"] on its own').toBeTruthy()
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

// The canvas is 16:9 and a phone held upright is not, so fullscreen leaves bars
// above and below the reading. Those bars are the video element's own
// background, and they are as much a component colour as the reading itself.
// app.css declares the rule with --ch-bg, like every other colour in the file,
// and the video carries data-theme="dark" (#615), so the frame is the same dark
// ground the canvas fills. The rule is CSS glue no unit test reaches, so it is
// pinned against the file, the way splash.test.js pins the FAB offsets.
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
