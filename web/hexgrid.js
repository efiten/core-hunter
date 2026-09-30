// Pure-JS port of the server's hex grid (server/internal/geo/hexgrid.go) so
// the app's live map draws the same cells as the website. Pointy-top hexes over
// Web Mercator; cell id "res:q:r".
import { resForZoom } from './zoomfade.js'

const R = 6378137.0;

function mercator(lat, lon) {
  return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}
function invMercator(x, y) {
  return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI]; // [lat,lon]
}

// One size per zoom level (#634), the server's rule: a cell is about
// HEX_TARGET_PX tall on screen at every zoom, point to point. The size is the
// circumradius in Web Mercator units and halves with every resolution.
// MERC_UPP_Z0 is Web Mercator units per pixel at Leaflet zoom 0 (world / 256).
//
// Until #634 the app had ten bands of a fixed size, 1500 down to 3 Mercator
// units, which the website had left behind: a cell ran from 19 to 75 px inside
// one band, and a change of band was a jump of a factor two or more.
export const HEX_TARGET_PX = 28
const MERC_UPP_Z0 = 156543.03392
export function hexSizeForRes(res) {
  return (HEX_TARGET_PX / 2) * MERC_UPP_Z0 / Math.pow(2, res)
}

// The finest resolution the app draws. The server stops at 18, which is where
// the website's zoom ends. The app is zoomed in further for the walk-in, and
// 21 keeps a cell at 28 px up to MapLibre zoom 20: 2.1 Mercator units, finer
// than the 3 the old bands ended on (docs/2026-06-29-hex-resolution-zoom.md).
// Below GPS accuracy a single cell is mostly noise; the hotspot the cells pile
// up into is what reads.
export const HEX_MAX_RES = 21

// hexResForZoom: the resolution drawn in full at a MapLibre zoom. The map
// blends it with its neighbour around every change (zoomfade.js).
export function hexResForZoom(z) {
  return resForZoom(z, HEX_MAX_RES)
}

function hexRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

export function hexCellAt(lat, lon, res) {
  const size = hexSizeForRes(res);
  const [x, y] = mercator(lat, lon);
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  const [qi, ri] = hexRound(q, r);
  return res + ':' + qi + ':' + ri;
}

// hexBoundary returns the cell's 6 corners as [lat,lon] pairs (Leaflet order),
// closed ring, or null on a malformed id.
export function hexBoundary(cellId) {
  const p = cellId.split(':');
  if (p.length !== 3) return null;
  const res = +p[0], q = +p[1], r = +p[2];
  const size = hexSizeForRes(res);
  const cx = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const cy = size * (1.5 * r);
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    ring.push(invMercator(cx + size * Math.cos(a), cy + size * Math.sin(a))); // [lat,lon]
  }
  ring.push(ring[0]);
  return ring;
}
