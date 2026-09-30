// What the map shows at a zoom, as shares between 0 and 1 (#634). Every rule
// here used to be a step in JS: a threshold crossed, the data rebuilt, and the
// thing appeared or vanished in one frame. A share is handed to the style as a
// zoom expression, so the map eases it while the fingers are still moving.
//
// The numbers are Kasper's, picked on 29 September 2026 by pinching through a
// mockup with 4559 receptions between Nijmegen and Arnhem, in 2D and in 3D.
// Zoom is MapLibre's throughout.
//
// Copied whole between app/src/ and web/ (parity.test.js), since neither deploy
// path can ship a file outside its own directory (#238). No imports.

// The points of this ride come in over the hex, which stays at full strength.
export const POINT_FADE_2D = { from: 13.25, to: 18.25 }
// Earlier rides come in as outlines. It was a step at zoom 12 (#668).
export const BACKLOG_FADE_2D = { from: 11.25, to: 18.75 }
// The names in a cell. It was a step at zoom 16.
export const LABEL_FADE = { from: 15.5, to: 16.5 }
// In 3D a pillar per reception is the most expensive thing on the map, so the
// pillars wait for the closest zoom and arrive in one step, this ride and the
// earlier ones together. From there the hex bars stand at 95% of their height,
// so the strongest pillar in a cell clears the bar it stands in.
export const POINT_STEP_3D = 19
export const HEX_UNDER_PILLARS_3D = 0.95
// How many zoom levels two cell sizes share while one takes over from the
// other, centred on the zoom where the size changes.
export const HEX_BLEND_2D = 0.95
export const HEX_BLEND_3D = 0.75
export const hexBlend = (mode3D) => (mode3D ? HEX_BLEND_3D : HEX_BLEND_2D)

const clamp01 = (v) => Math.max(0, Math.min(1, v))
// ramp: 0 up to `from`, 1 from `to`, a straight line between. A band of no
// width is a step at `from`.
export function ramp(z, { from, to }) {
  if (!(to > from)) return z >= from ? 1 : 0
  return clamp01((z - from) / (to - from))
}

// The layer modes. 'auto' took the place of 'both': the two layers together,
// each at the share its zoom gives it. 'hex' and 'points' draw one layer at
// full strength, whatever the zoom.
export const LAYER_MODES = ['auto', 'hex', 'points']
const modeOf = (mode) => (LAYER_MODES.includes(mode) ? mode : 'auto')

export function pointShare(z, { mode, mode3D } = {}) {
  const m = modeOf(mode)
  if (m === 'hex') return 0
  if (m === 'points') return 1
  return mode3D ? (z >= POINT_STEP_3D ? 1 : 0) : ramp(z, POINT_FADE_2D)
}
export function hexShare(z, { mode, mode3D } = {}) {
  const m = modeOf(mode)
  if (m === 'points') return 0
  if (m === 'hex' || !mode3D) return 1
  return z >= POINT_STEP_3D ? HEX_UNDER_PILLARS_3D : 1
}
// An earlier ride's share of its own point. In 3D it arrives with the pillars.
export function backlogShare(z, { mode3D } = {}) {
  return mode3D ? 1 : ramp(z, BACKLOG_FADE_2D)
}
export const labelShare = (z) => ramp(z, LABEL_FADE)

// ---- cell sizes -------------------------------------------------------------
// One size per zoom level, the server's rule (server/internal/geo/hexgrid.go):
// the resolution is the Leaflet zoom, which is MapLibre's plus one, rounded
// (web/mapmodel.js leafletZoom). So resolution r is the one drawn from zoom
// r - 1.5 up to r - 0.5, and the size changes on every half.
export const HEX_MIN_RES = 3
export function resForZoom(z, maxRes) {
  return Math.max(HEX_MIN_RES, Math.min(maxRes, Math.round(Number(z) + 1)))
}
// The two sizes alive around the nearest change of size: the coarser below it
// and the finer above. At the ends of the range the two are the same one.
export function resPair(z, maxRes) {
  const k = Math.floor(Number(z))
  const lim = (r) => Math.max(HEX_MIN_RES, Math.min(maxRes, r))
  return { coarse: lim(k + 1), fine: lim(k + 2) }
}
// resShare: how much of resolution `res` the map shows at zoom z. Full inside
// its own zoom level, and over `width` levels around each end it hands over to
// its neighbour, so the two shares always add up to 1. The coarsest and the
// finest have no neighbour on one side and stay full there. `minRes` and
// `maxRes` are the sizes there are: the website holds the pair it fetched as
// its whole range, so that pair stays on the map when the zoom runs past it
// before the next one arrives.
export function resShare(res, z, width, maxRes, minRes = HEX_MIN_RES) {
  const lo = res - 1.5, hi = res - 0.5
  const up = res <= minRes ? 1 : ramp(z, { from: lo - width / 2, to: lo + width / 2 })
  const down = res >= maxRes ? 0 : ramp(z, { from: hi - width / 2, to: hi + width / 2 })
  return Math.min(up, 1 - down)
}
// The zooms where resShare bends, which is where an expression needs a stop.
export function resBreaks(res, width, maxRes, minRes = HEX_MIN_RES) {
  const lo = res - 1.5, hi = res - 0.5
  return [
    ...(res <= minRes ? [] : [lo - width / 2, lo + width / 2]),
    ...(res >= maxRes ? [] : [hi - width / 2, hi + width / 2]),
  ]
}

// ---- style expressions --------------------------------------------------------
// MapLibre takes ['zoom'] only as the input of a top-level interpolate or
// step, so a share cannot be multiplied into a paint value around the ramp.
// It rides in each stop's output instead: `wrap` turns the share at a stop
// into that output, e.g. (v) => ['*', ['get', 'op'], v].
//
// A step inside a ramp is two stops STEP_EPS apart, since stops have to rise.
export const STEP_EPS = 0.001
const round3 = (v) => Math.round(v * 1000) / 1000
function stopsFor(breaks) {
  const zs = [...new Set(breaks.map(round3))].sort((a, b) => a - b)
  return zs.length ? zs : [0]
}
// zoomRamp: a linear interpolate through shareAt at every break. Exact when
// shareAt is a straight line between two breaks.
export function zoomRamp(breaks, shareAt, wrap = (v) => v) {
  const zs = stopsFor(breaks)
  if (zs.length === 1) return wrap(round3(shareAt(zs[0])))
  return ['interpolate', ['linear'], ['zoom'], ...zs.flatMap((z) => [z, wrap(round3(shareAt(z)))])]
}
// zoomSwitch: 1 where shareAt is above nothing, 0 elsewhere, as a step. For
// what cannot be partly there: a fill-extrusion of no height still draws an
// opaque polygon on the ground, and one with an opacity between 0 and 1
// dissolves toward black (docs/2026-09-04-new-versus-old-on-the-map.md).
export function zoomSwitch(breaks, shareAt) {
  const zs = stopsFor(breaks)
  const on = (z) => (shareAt(z) > 0 ? 1 : 0)
  // The value of a segment is the value just inside it.
  const inside = (i) => on(i + 1 < zs.length ? (zs[i] + zs[i + 1]) / 2 : zs[i] + 1)
  return ['step', ['zoom'], on(zs[0] - 1), ...zs.flatMap((z, i) => [z, inside(i)])]
}
// A step at `at`, as the two breaks a ramp needs for it.
export const stepBreaks = (at) => [at - STEP_EPS, at]
// Breaks every `every` zoom levels between two zooms, for a share that is a
// curve there (the product of two ramps).
export function sampledBreaks(from, to, every = 0.25) {
  const out = []
  for (let z = from; z < to + 1e-9; z += every) out.push(z)
  out.push(to)
  return out
}

// ---- what the layers are painted with ------------------------------------------
// Two hex layers, since two cell sizes are on the map while one takes over
// from the other. A size keeps its layer for as long as it is drawn: the even
// resolutions go to slot a and the odd ones to b. The pair moves up one at
// every whole zoom, which is the middle of a level, where the size that stays
// is at full strength and the one that leaves is at nothing. So the swap is
// never seen.
export function hexSlots(z, maxRes) {
  const { coarse, fine } = resPair(z, maxRes)
  const slots = { a: null, b: null }
  for (const res of [coarse, fine]) slots[res % 2 === 0 ? 'a' : 'b'] = res
  return slots
}

const hexBreaks = (res, view, maxRes, minRes) => [
  ...resBreaks(res, hexBlend(view.mode3D), maxRes, minRes),
  // The bars drop to 95% where the pillars arrive, in auto in 3D only.
  ...(view.mode3D && modeOf(view.mode) === 'auto' ? stepBreaks(POINT_STEP_3D) : []),
]
const hexShareOf = (res, view, maxRes, minRes) => (z) => resShare(res, z, hexBlend(view.mode3D), maxRes, minRes) * hexShare(z, view)

// The flat cells: each cell's own opacity ('op') times the share.
export function hexFillOpacity(res, view, maxRes, minRes) {
  return zoomRamp(hexBreaks(res, view, maxRes, minRes), hexShareOf(res, view, maxRes, minRes), (v) => ['*', ['get', 'op'], v])
}
// The bars: a bar cannot be see-through, so its share is its height, and the
// layer is switched off where the share is nothing.
export function hexBarHeight(res, view, maxRes, minRes) {
  return zoomRamp(hexBreaks(res, view, maxRes, minRes), hexShareOf(res, view, maxRes, minRes), (v) => ['*', ['get', 'height'], v])
}
export function hexBarSwitch(res, view, maxRes, minRes) {
  return zoomSwitch(hexBreaks(res, view, maxRes, minRes), hexShareOf(res, view, maxRes, minRes))
}

// The flat points. A point of an earlier ride ('backlog' 1) has no fill and
// takes the share of the points times its own, which is a curve where both
// move, so that stretch is sampled.
const BACKLOG = ['==', ['get', 'backlog'], 1]
const pointBreaks = (view) => (modeOf(view.mode) === 'auto' ? [POINT_FADE_2D.from, POINT_FADE_2D.to] : [])
export function pointFillOpacity(view) {
  return zoomRamp(pointBreaks(view), (z) => pointShare(z, view), (v) => ['case', BACKLOG, 0, ['*', ['get', 'fop'], v]])
}
export function pointStrokeOpacity(view) {
  const zs = [...pointBreaks(view), ...sampledBreaks(BACKLOG_FADE_2D.from, BACKLOG_FADE_2D.to)]
  const at = (z) => {
    const p = pointShare(z, view)
    return ['case', BACKLOG, ['*', ['get', 'op'], round3(p * backlogShare(z, view))], ['*', ['get', 'op'], round3(p)]]
  }
  const stops = stopsFor(zs)
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap((z) => [z, at(z)])]
}
// The pillars: on or off, never partly (zoomSwitch).
export function pillarSwitch(view) {
  if (modeOf(view.mode) !== 'auto') return pointShare(0, view)
  return zoomSwitch(stepBreaks(POINT_STEP_3D), (z) => pointShare(z, view))
}

// The same two ramps for a layer that names its own properties. The website's
// cells carry an outline and its points no ride, so it writes its own outputs
// around the shares the app uses.
export function hexRamp(res, view, maxRes, wrap, minRes) {
  return zoomRamp(hexBreaks(res, view, maxRes, minRes), hexShareOf(res, view, maxRes, minRes), wrap)
}
export function pointRamp(view, wrap) {
  return zoomRamp(pointBreaks(view), (z) => pointShare(z, view), wrap)
}
