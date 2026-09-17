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
import { rssiTier } from './signal.js'

// floatModel is everything the window draws, as plain values. It follows the
// HUD's rules: senderReadout for the name, rssiTier with the plot offset for
// the colour, the stand and the eye from hudmode.
export function floatModel({ rec, sinceText, mode, hidden, ble, mqtt, offsetDb = 0 } = {}) {
  const has = !!rec
  const all = mode === 'all'
  return {
    rssi: has && rec.rssi != null ? String(rec.rssi) : '—',
    snr: has && rec.snr != null ? 'SNR ' + Number(rec.snr).toFixed(1) + ' dB' : 'SNR —',
    since: sinceText || '—',
    who: senderReadout(rec).text,
    tier: has ? rssiTier(rec.rssi, offsetDb) : 'none',
    stand: all ? 'ALL' : 'FILTERED',
    eye: !all && (Number(hidden) || 0) > 0,
    dots: { ble: !!ble, mqtt: !!mqtt },
    warning: ble ? '' : 'Disconnected',
  }
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

// Canvas size. 4:3, so the PiP window Android cuts from it is squarer than a
// film frame and holds four lines; fullscreen letterboxes, and app.css paints
// those bars with --ch-bg, the same ground this canvas fills below.
const W = 800, H = 600

// createFloatReadout owns the canvas, the video and the drawing. `colors`
// resolves a --ch-* token to a colour at draw time, so the window follows the
// theme without this module reading the stylesheet. `orientation` is
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
    const bg = colors('--ch-bg')
    const alert = colors('--ch-accent-2')
    const accent = colors('--ch-accent')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    // The tier is the window: a tint from the top and a bar down the left, so
    // from the corner of an eye the colour alone says closer or further.
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, withAlpha(tier, 0.28))
    g.addColorStop(1, withAlpha(tier, 0.08))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = tier
    ctx.fillRect(0, 0, 28, H)
    const mono = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace'
    // Hero RSSI, white, with the unit small beside it.
    ctx.fillStyle = text
    ctx.textBaseline = 'alphabetic'
    ctx.font = `700 190px ${mono}`
    ctx.fillText(m.rssi, 64, 230)
    const w = ctx.measureText(m.rssi).width
    ctx.font = `500 52px ${mono}`
    ctx.fillStyle = muted
    ctx.fillText('dBm', 64 + w + 22, 230)
    // SNR left, age right.
    ctx.font = `500 54px ${mono}`
    ctx.fillStyle = muted
    ctx.fillText(m.snr, 64, 320)
    ctx.textAlign = 'right'
    ctx.fillText(m.since, W - 48, 320)
    ctx.textAlign = 'left'
    // Sender.
    ctx.font = `600 62px ${mono}`
    ctx.fillStyle = text
    fitText(ctx, m.who, 64, 440, W - 112)
    // Footer: the stand with the eye, the two link dots, and the warning.
    ctx.font = `700 36px ${mono}`
    let x = 64
    if (m.eye) { dot(ctx, x + 14, 526, 14, alert); x += 44 }
    ctx.fillStyle = accent
    ctx.fillText(m.stand, x, 540)
    dot(ctx, W - 176, 526, 13, m.dots.ble ? accent : muted)
    dot(ctx, W - 132, 526, 13, m.dots.mqtt ? accent : muted)
    if (m.warning) {
      ctx.fillStyle = alert
      ctx.textAlign = 'right'
      ctx.fillText(m.warning.toUpperCase(), W - 216, 540)
      ctx.textAlign = 'left'
    }
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

function dot(ctx, cx, cy, r, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

// fitText draws a line and shortens it with an ellipsis when it would run past
// maxWidth: the name is the one line whose length the app does not control.
function fitText(ctx, s, x, y, maxWidth) {
  let t = String(s)
  if (ctx.measureText(t).width <= maxWidth) { ctx.fillText(t, x, y); return }
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  ctx.fillText(t + '…', x, y)
}

// withAlpha turns a #rrggbb token value into rgba(); a token that is not hex
// (rgba() already) is used as-is, and the tint then simply is that colour.
function withAlpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
