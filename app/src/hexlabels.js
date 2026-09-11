// What a hex cell says about who was heard in it (#556).
//
// The cell's colour is the strongest signal heard there; the label is the
// nodes: the 4-character prefixes of the ids heard in the cell, newest first,
// three at most. A prefix is the house form for an id (idPrefix, feed.js),
// never a name, and it comes only from a record that carries an id of a node:
// a 1-byte hash names one of 256 (direct_hash, path_hash, names.js), and a
// refused identity carries no id at all (#558). Neither is printed as who was
// here.
//
// Kasper chose prefixes over a count (2026-09-04); #549's reach outline will
// share this label's spot, so the two never fight for it.
import { isHashIdKind } from './names.js'

export const HEX_LABEL_MIN_ZOOM = 16
export const HEX_LABEL_MAX = 3
const PREFIX_CHARS = 4

export function hexCellLabel(records) {
  const rows = (records || [])
    .filter((r) => r && r.sender_id != null && String(r.sender_id).length >= PREFIX_CHARS && !isHashIdKind(r.sender_kind))
    .map((r) => ({ p: String(r.sender_id).toLowerCase().slice(0, PREFIX_CHARS), t: Date.parse(r.rx_at) || 0 }))
    .sort((a, b) => b.t - a.t)
  const seen = []
  for (const { p } of rows) if (!seen.includes(p)) seen.push(p)
  if (!seen.length) return ''
  const shown = seen.slice(0, HEX_LABEL_MAX)
  const more = seen.length - shown.length
  return shown.join(' ') + (more > 0 ? ` +${more}` : '')
}

// Four characters at 10px need a cell wider than the label: at zoom 16 a cell
// is about 110 m across and the label fits with room, at 15 it does not.
export function showHexLabels(zoom) {
  return Number(zoom) >= HEX_LABEL_MIN_ZOOM
}

// planHexLabels: what the map changes when the labelled cells in view change.
// `drawn` maps each cell id that has a marker to the text it shows; `items`
// are the cells to label now, as { id, label, ... }. A cell keeps its marker
// while it stays in view, so one reception in one cell relabels one marker
// rather than rebuilding every label on screen. The id carries the hex
// resolution ("res:q:r", hexgrid.js), so after a zoom that changes it every
// cell is a new one, placed at its own centre.
export function planHexLabels(drawn, items) {
  const inView = new Set(items.map((it) => it.id))
  return {
    add: items.filter((it) => !drawn.has(it.id)),
    relabel: items.filter((it) => drawn.has(it.id) && drawn.get(it.id) !== it.label),
    remove: [...drawn.keys()].filter((id) => !inView.has(id)),
  }
}
