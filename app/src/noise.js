// The radio noise floor, sampled and mapped (#410). The companion reports it
// over CMD_GET_STATS / STATS_TYPE_RADIO (docs/stats_binary_frames.md in
// meshcore-dev/MeshCore, firmware v8+), a local BLE query that puts nothing on
// the air. Ported in part from efiten/coredrive-rx src/rfstats.js, which keeps
// the same reading with a position and a stationary flag.
//
// A stretch with no receptions reads the same whether it was out of coverage
// or drowned in noise, two answers that call for opposite moves (#277). The
// noise floor per place is what tells them apart.

import { haversineM } from './geometry.js'
import { INTERVAL_MS, MOVE_THRESHOLD_M } from './autoping.js'

export const CMD_GET_STATS = 56
export const RESP_CODE_STATS = 24
export const STATS_TYPE_RADIO = 1

export function buildStatsRadioRequest() {
  return new Uint8Array([CMD_GET_STATS, STATS_TYPE_RADIO])
}

// parseStatsRadio reads the noise floor, and only that (#410's scope). The
// frame is 14 bytes: [24][1][noise_floor int16 LE][last_rssi][last_snr]
// [tx_air_secs u32][rx_air_secs u32]. The firmware holds the value at 0 from
// begin() and every AGC reset until 64 samples are averaged
// (src/helpers/radiolib/RadioLibWrappers.cpp), so 0 is "not measured yet",
// and a noise floor is never 0 dBm or above. It clamps at -120 from below;
// -140 keeps room for firmware that does not.
export function parseStatsRadio(bytes) {
  if (!bytes || bytes.length < 14 || bytes[0] !== RESP_CODE_STATS || bytes[1] !== STATS_TYPE_RADIO) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(2, true)
  return { noiseFloor: v >= -140 && v < 0 ? v : null }
}

// shouldSampleNoise: auto-discover's rhythm (Kasper, 2026-09-25), every
// INTERVAL_MS or sooner after MOVE_THRESHOLD_M, and whether auto-discover is on
// or not, since the reading costs no airtime. `last` is the previous sample.
export function shouldSampleNoise({ last, now, lat, lon }) {
  if (!last) return true
  if (now - last.at >= INTERVAL_MS) return true
  if (lat == null || lon == null || last.lat == null || last.lon == null) return false
  return haversineM({ lat: last.lat, lon: last.lon }, { lat, lon }) >= MOVE_THRESHOLD_M
}

// noiseSample is the record kept for one reading, or null when there is
// nothing to map: no reading, or no fix to place it. A sample within the move
// distance of the previous one is stationary, so a park cannot outvote a pass
// in its cell (noiseCells). `session` is the connection it was taken in.
export function noiseSample({ noiseFloor, fix, session, rxPubkey, nowMs, last }) {
  if (noiseFloor == null || !fix || fix.lat == null || fix.lon == null) return null
  const stationary = !!(last && last.lat != null && haversineM({ lat: last.lat, lon: last.lon }, { lat: fix.lat, lon: fix.lon }) < MOVE_THRESHOLD_M)
  return {
    at: new Date(nowMs).toISOString(),
    lat: fix.lat,
    lon: fix.lon,
    acc_m: fix.acc_m ?? null,
    noise_floor: noiseFloor,
    session,
    rx_pubkey: String(rxPubkey || '').toLowerCase(),
    stationary,
  }
}

function median(values) {
  const v = [...values].sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// noiseCells gives each cell the median noise floor measured in it, and how
// many readings that median is over. The stationary samples of one session in
// one cell count once, as their own median: ten minutes parked is one place,
// not sixty readings of it. `cellOf(sample)` names the cell.
export function noiseCells(samples, cellOf) {
  const byCell = new Map()
  for (const s of samples || []) {
    if (s == null || s.noise_floor == null) continue
    const cell = cellOf(s)
    if (cell == null) continue
    if (!byCell.has(cell)) byCell.set(cell, { moving: [], parked: new Map() })
    const c = byCell.get(cell)
    if (s.stationary) {
      if (!c.parked.has(s.session)) c.parked.set(s.session, [])
      c.parked.get(s.session).push(s.noise_floor)
    } else c.moving.push(s.noise_floor)
  }
  const out = new Map()
  for (const [cell, c] of byCell) {
    const values = [...c.moving, ...[...c.parked.values()].map(median)]
    out.set(cell, { median: median(values), n: values.length })
  }
  return out
}

// ---- the map layer ----
// Where a cell steps up a band, in dBm, quietest first. Below the first a
// cell is clear: the usual floor of a quiet place, nothing to explain.
export const NOISE_BANDS = [-119, -113, -107, -101]

// The fill for the noise cells. `colors` are the four band tokens
// (--ch-noise-1..4), read by the caller: a paint property cannot read a CSS
// variable. Bright blue that gets stronger as it gets louder (Kasper,
// 2026-09-25), because black on the dark basemap hid exactly the loud cells.
export function noiseFill(colors) {
  return ['step', ['get', 'nf'], 'rgba(0,0,0,0)',
    NOISE_BANDS[0], colors[0], NOISE_BANDS[1], colors[1], NOISE_BANDS[2], colors[2], NOISE_BANDS[3], colors[3]]
}

// withNoise: with the layer on, the noise cells take the place of the signal
// cells, and are drawn as cells whatever the view (Kasper, 2026-09-25). The
// points stay: they are what the noise explains. The hex labels go with the
// cells they name.
export function withNoise(vis, on) {
  if (!on) return { ...vis, noise: false }
  const out = { ...vis, noise: true }
  for (const id of ['hex', 'hex-3d', 'hex-labels']) if (id in out) out[id] = false
  return out
}

// noiseHexFC: one polygon per cell, with its median as `nf`. `cellAt(lat, lon)`
// names a cell and `boundary(id)` gives its ring as [lat, lon] pairs, the
// hexgrid.js pair, passed in so the zoom's resolution stays the caller's.
export function noiseHexFC(samples, cellAt, boundary) {
  const features = []
  for (const [id, c] of noiseCells(samples, (s) => cellAt(s.lat, s.lon))) {
    const ring = boundary(id)
    if (!ring) continue
    features.push({ type: 'Feature', properties: { nf: c.median, count: c.n },
      geometry: { type: 'Polygon', coordinates: [ring.map(([lat, lon]) => [lon, lat])] } })
  }
  return { type: 'FeatureCollection', features }
}
