// Pure-JS port of CoreScope's server hex grid (cmd/server/hexgrid.go) so the
// app's live map uses the SAME cells as the analyzer coverage map. Pointy-top
// hexes over Web Mercator; cell id "res:q:r".
const R = 6378137.0;

function mercator(lat, lon) {
  return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}
function invMercator(x, y) {
  return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI]; // [lat,lon]
}

export function hexSizeForRes(res) {
  switch (true) {
    case res >= 15: return 3;
    case res === 14: return 5;
    case res === 13: return 10;
    case res === 12: return 20;
    case res === 11: return 40;
    case res === 10: return 90;
    case res === 9: return 180;
    case res === 8: return 360;
    case res === 7: return 720;
    default: return 1500;
  }
}

// hexResForZoom maps the map zoom to a hex resolution. Coarser bands mirror the
// server's zoomToHexRes; res 12–15 (20/10/5/3 m) extend it so the live map gets
// finer cells than the server's 40 m floor when zoomed in for close-range
// localization (down to 3 m at max zoom). Below GPS accuracy a single point is
// mostly noise, but the aggregated heat still surfaces the hotspot.
export function hexResForZoom(z) {
  if (z >= 19) return 15;
  if (z >= 18) return 14;
  if (z >= 17) return 13;
  if (z >= 16) return 12;
  if (z >= 15) return 11;
  if (z >= 13) return 10;
  if (z >= 11) return 9;
  if (z >= 9) return 8;
  if (z >= 7) return 7;
  return 6;
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
