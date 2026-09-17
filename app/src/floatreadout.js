// The float readout (#555): the HUD's reading drawn onto a canvas, streamed
// into a <video>, and taken out of the page (#616). Where the browser has the
// picture-in-picture API on, the video goes straight into its floating
// window. Android Chrome has that API off, so there the video goes fullscreen
// instead, locked upright, and Chrome moves the fullscreen video into its
// floating window by itself when the user presses Home or switches apps.
// Chrome's automatic PiP through the Media Session API is desktop-only.
//
// floatModel, floatSupported and createFloatReadout's open path are
// unit-tested against fakes; the drawing is canvas glue, verified by build
// and in the browser like huntmap.js.
import { senderReadout } from './hudsender.js'
import { hudToggleText } from './hudmode.js'
import { rssiTier } from './signal.js'

// floatModel is everything the window draws, as plain values. It follows the
// HUD's rules: senderReadout for the sender line, rssiTier with the plot
// offset for the colour, hudToggleText for the stand and the eye. Before the
// first reception there is nothing to show, and the window says so (empty)
// instead of drawing placeholders.
export function floatModel({ rec, sinceText, mode, hidden, ble, mqtt, offsetDb = 0, dir = null } = {}) {
  const has = !!rec
  const { prefix, name, note } = senderReadout(rec)
  const toggle = hudToggleText(mode, hidden)
  return {
    empty: !has,
    rssi: has && rec.rssi != null ? String(rec.rssi) : '',
    snr: has && rec.snr != null ? 'SNR ' + Number(rec.snr).toFixed(1) + ' dB' : '',
    since: has ? sinceText || '' : '',
    tier: has ? rssiTier(rec.rssi, offsetDb) : 'none',
    sender: { prefix, name, note },
    stand: toggle.label,
    eye: toggle.eye,
    links: { ble: !!ble, mqtt: !!mqtt },
    status: ble ? '' : 'Disconnected',
    // The direction arrow (#660), from arrow.js; only with a reception.
    dir: has && dir ? dir : null,
  }
}

// fitName cuts a name to maxWidth by whole graphemes, ending in an ellipsis,
// so an emoji in a node's name is never split into a replacement glyph.
// `measure` is the canvas's text width; the numbers never pass through here.
export function fitName(text, maxWidth, measure) {
  const s = String(text ?? '')
  if (measure(s) <= maxWidth) return s
  const g = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment)
    : Array.from(s)
  while (g.length > 1 && measure(g.join('') + '\u2026') > maxWidth) g.pop()
  return g.join('') + '\u2026'
}

// floatSupported: can this browser stream a canvas into a video and take that
// video out of the page? Element fullscreen is the Android path; iOS has only
// webkitEnterFullscreen, which still shows the readout big. Picture-in-picture
// counts only where the document says it is enabled: Android Chrome's video
// has the method with the API switched off.
export function floatSupported(win) {
  if (!win || !win.document) return false
  const canvas = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype
  const video = win.HTMLVideoElement && win.HTMLVideoElement.prototype
  if (!canvas || typeof canvas.captureStream !== 'function') return false
  if (!video) return false
  return typeof video.requestFullscreen === 'function' || typeof video.webkitEnterFullscreen === 'function'
    || (!!win.document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function')
}

// Canvas size. 16:9, the shape of the window Android gives a video: measured
// at 548x308 and 505x284 device px on a 1080px phone (1.78). The old 4:3
// canvas filled 75% of that width and left a band on each side (#615). The
// text sizes stayed, so the sender line holds about 25 characters, not 18.
// Fullscreen letterboxes an upright phone, and app.css paints those bars with
// --ch-bg, the same dark ground this canvas fills below.
const W = 1067, H = 600
// The text's left edge, past the 28px tier bar, and its right edge.
const L = 72, R = W - 56

// createFloatReadout owns the canvas, the video and the drawing. `colors`
// resolves a --ch-* token to a colour at draw time, read from the canvas,
// which carries data-theme="dark": the window is dark whatever the app's
// theme, without this module reading the stylesheet (#615). `orientation` is
// screen.orientation, passed in so the lock can be tested.
export function createFloatReadout({ canvas, video, colors, onChange, orientation = globalThis.screen && globalThis.screen.orientation }) {
  if (!canvas || !video || !canvas.captureStream) return { supported: false, draw() {}, open() {}, close() {}, isOpen: () => false }
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  // captureStream(0): frames flow only when requestFrame says so, so the
  // stream costs nothing between receptions and nothing depends on
  // requestAnimationFrame, which a hidden page never runs.
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0]
  video.srcObject = stream
  video.muted = true
  const doc = video.ownerDocument
  let model = null
  let out = false
  let opening = null

  function draw(next) {
    if (next) model = next
    const m = model || floatModel({})
    const tier = colors(`--ch-sig-${m.tier}`)
    const text = colors('--ch-text')
    const muted = colors('--ch-muted')
    const alert = colors('--ch-accent-2')
    const accent = colors('--ch-accent')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = colors('--ch-bg')
    ctx.fillRect(0, 0, W, H)
    // The tier bar down the left: from the corner of an eye the colour alone
    // says closer or further. The number wears the same colour, as on the HUD.
    ctx.fillStyle = tier
    ctx.fillRect(0, 0, 28, H)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    if (m.empty) {
      ctx.fillStyle = text
      ctx.font = `700 92px ${MONO}`
      ctx.fillText('No reception yet', L, 210)
      ctx.fillStyle = muted
      ctx.font = `500 50px ${MONO}`
      ctx.fillText('The reading appears here', L, 320)
      ctx.fillText('when a packet comes in.', L, 382)
    } else {
      if (m.rssi) {
        ctx.fillStyle = tier
        ctx.font = `700 190px ${MONO}`
        ctx.fillText(m.rssi, L, 230)
        const w = ctx.measureText(m.rssi).width
        ctx.fillStyle = muted
        ctx.font = `500 52px ${MONO}`
        ctx.fillText('dBm', L + w + 22, 230)
      }
      if (m.dir) drawDirection(ctx, m.dir, tier)
      // SNR left, age right. Numbers are never cut.
      ctx.fillStyle = muted
      ctx.font = `500 54px ${MONO}`
      ctx.fillText(m.snr, L, 322)
      ctx.textAlign = 'right'
      ctx.fillText(m.since, R, 322)
      ctx.textAlign = 'left'
      // The sender line: "via ~" muted and whole, the name cut from its end,
      // or the note ("Trace, no sender id") muted.
      ctx.font = `600 62px ${MONO}`
      const measure = (s) => ctx.measureText(s).width
      if (m.sender.note) {
        ctx.fillStyle = muted
        ctx.fillText(fitName(m.sender.note, R - L, measure), L, 442)
      } else {
        let x = L
        if (m.sender.prefix) {
          ctx.fillStyle = muted
          ctx.fillText(m.sender.prefix, x, 442)
          x += measure(m.sender.prefix)
        }
        ctx.fillStyle = text
        ctx.fillText(fitName(m.sender.name, R - x, measure), x, 442)
      }
    }
    // Footer: the stand in the HUD's word with its closed eye when the filter
    // kept receptions off, the status when BLE is gone, and the two links by
    // name on the right, a filled dot when up and a hollow one when down.
    const y = 548
    ctx.fillStyle = accent
    ctx.font = `700 38px ${MONO}`
    ctx.fillText(m.stand, L, y)
    let sx = L + ctx.measureText(m.stand).width
    if (m.eye) { drawEye(ctx, sx + 16, y - 32, 36, accent); sx += 16 + 36 }
    if (m.status) {
      ctx.fillStyle = alert
      ctx.font = `600 36px ${MONO}`
      ctx.fillText(m.status, sx + 34, y)
    }
    ctx.font = `600 36px ${MONO}`
    ctx.textAlign = 'right'
    let rx = R
    for (const [word, up] of [['MQTT', m.links.mqtt], ['BLE', m.links.ble]]) {
      ctx.fillStyle = up ? muted : alert
      ctx.fillText(word, rx, y)
      rx -= ctx.measureText(word).width + 22
      linkDot(ctx, rx, y - 13, 11, up ? accent : alert, !up)
      rx -= 11 + 40
    }
    ctx.textAlign = 'left'
    if (track && track.requestFrame) track.requestFrame()
  }

  // open: draw the given reading, play, and take the video out of the page.
  // Must run inside a tap: play() on a fresh stream, requestPictureInPicture
  // and requestFullscreen all need the gesture. The reading is drawn first,
  // because the window shows the canvas's current frame the moment it opens.
  // A second tap while the first is still asking gets the same attempt.
  function open(next) {
    if (!opening) opening = openOnce(next).finally(() => { opening = null })
    return opening
  }

  async function openOnce(next) {
    draw(next)
    try { await video.play() } catch (_) {}
    if (await floatWindow() || await fullscreen()) { setOpen(true); return }
    // Every path was refused: nothing left the page, so the button must not
    // say it did, and the stream stops.
    try { video.pause() } catch (_) {}
  }

  // The floating window itself, where the browser has the API on.
  async function floatWindow() {
    if (!doc.pictureInPictureEnabled || !video.requestPictureInPicture) return false
    try { await video.requestPictureInPicture(); return true } catch (_) { return false }
  }

  // Fullscreen, the Android path. The canvas is landscape, so Chrome would
  // turn the phone's screen sideways; the portrait lock keeps the readout
  // upright. A lock is only allowed while fullscreen, so it waits for that,
  // and a refused lock still leaves the readout out. iPhone Safari has no
  // element fullscreen, only the video's own player.
  async function fullscreen() {
    if (video.requestFullscreen) {
      try { await video.requestFullscreen() } catch (_) { return false }
      try { if (orientation && orientation.lock) await orientation.lock('portrait') } catch (_) {}
      return true
    }
    if (!video.webkitEnterFullscreen) return false
    try { video.webkitEnterFullscreen(); return true } catch (_) { return false }
  }

  async function close() {
    try { if (doc.fullscreenElement === video && doc.exitFullscreen) await doc.exitFullscreen() } catch (_) {}
    try { if (doc.pictureInPictureElement === video && doc.exitPictureInPicture) await doc.exitPictureInPicture() } catch (_) {}
    try { video.pause() } catch (_) {}
    setOpen(false)
  }

  function setOpen(v) {
    if (v === out) return
    out = v
    if (onChange) onChange(out)
  }

  // The window can be closed from outside the page: the ✕ on the PiP window,
  // the back gesture out of fullscreen. Both end here so the button agrees.
  // Deferred, because Android moves a fullscreen video into its floating
  // window in two steps: fullscreen ends first, and pictureInPictureElement is
  // set a moment later. Checking on the same tick would read that hand-over
  // as a close and pause the stream under the window.
  let syncTimer = null
  const sync = () => {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      const stillOut = doc.fullscreenElement === video || doc.pictureInPictureElement === video
      if (!stillOut && out) { try { video.pause() } catch (_) {} setOpen(false) }
    }, 600)
  }
  // The portrait lock belongs to the fullscreen step only, so it is released
  // the moment fullscreen ends, not after the hand-over wait.
  doc.addEventListener('fullscreenchange', () => {
    if (doc.fullscreenElement !== video) { try { if (orientation && orientation.unlock) orientation.unlock() } catch (_) {} }
    sync()
  })
  video.addEventListener('leavepictureinpicture', sync)
  video.addEventListener('webkitendfullscreen', sync)
  video.addEventListener('enterpictureinpicture', () => { clearTimeout(syncTimer); setOpen(true) })

  return { supported: true, draw, open, close, isOpen: () => out }
}

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace'

// The direction arrow (#660): top right, beside the number, in the reading's
// tier colour. A navigation arrow pointing up, in unit coordinates (tip, right
// wing, notch, left wing), turned by the angle from straight ahead. Filled for
// an advertised position, outlined for an estimate. No ring and no distance.
const ARROW = [[0, -1], [0.62, 0.78], [0, 0.42], [-0.62, 0.78]]
const DIR_X = W - 148, DIR_Y = 136, DIR_SIZE = 84
function drawDirection(ctx, dir, color) {
  const a = (dir.angle * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  ctx.beginPath()
  ARROW.forEach(([px, py], i) => {
    const x = DIR_X + DIR_SIZE * (px * cos - py * sin)
    const y = DIR_Y + DIR_SIZE * (px * sin + py * cos)
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
  })
  ctx.closePath()
  ctx.lineJoin = 'round'
  if (dir.kind === 'advertised') { ctx.fillStyle = color; ctx.fill() } else { ctx.lineWidth = 9; ctx.strokeStyle = color; ctx.stroke() }
}

function linkDot(ctx, cx, cy, r, color, hollow) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  if (hollow) { ctx.lineWidth = 5; ctx.strokeStyle = color; ctx.stroke() } else { ctx.fillStyle = color; ctx.fill() }
}

// The HUD's closed eye (index.html .hud-eye), on its 20-unit grid, drawn at
// `size` px with its top left at (x, y).
const EYE_PATHS = [
  'M3 3l14 14',
  'M8.5 5.3A8.6 8.6 0 0 1 10 5.2c4.2 0 7.3 3.4 8.3 4.8-.5.7-1.4 1.8-2.6 2.8M6.2 6.8C4 8 2.4 9.5 1.7 10c1 1.4 4.1 4.8 8.3 4.8 1.2 0 2.3-.3 3.3-.7',
  'M8.2 8.2a2.5 2.5 0 0 0 3.6 3.6',
]
function drawEye(ctx, x, y, size, color) {
  if (typeof Path2D !== 'function') return
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 20, size / 20)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.7
  ctx.lineCap = 'round'
  for (const d of EYE_PATHS) ctx.stroke(new Path2D(d))
  ctx.restore()
}
