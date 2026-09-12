// What the HUD shows, and what it can do with it (#555).
//
// The HUD used to be written from every capture, before the filter: narrow
// the map to one target and the readout still jumped to every passer-by. It
// now follows the same filtered/all stand as the receptions ticker — one
// stand, flipped from either place — so with a filter set you look at the
// filtered set on both. The rules below are pure so app.js's glue stays thin.
import { isTargetKind } from './feed.js'

// hudShows: does this reception replace what the HUD shows? `matches` is
// makeFilter's verdict for it. Anything that is not an explicit true counts
// as not matching: "shown" is the wrong side to fail on when the stand says
// filtered.
export function hudShows(mode, matches) {
  return mode === 'all' || matches === true
}

// hiddenAfter: how many receptions the filter has kept off the HUD since the
// one it shows. A shown reception resets it; in all mode nothing is hidden.
export function hiddenAfter(count, { mode, matches }) {
  return hudShows(mode, matches) ? 0 : (count || 0) + 1
}

// hudToggleText: what the filtered/all button says. The closed eye is the one
// visible sign that the filter is keeping something off the HUD; the count
// itself is for assistive tech and the tooltip, not the row.
export function hudToggleText(mode, hidden) {
  const all = mode === 'all'
  const n = all ? 0 : Number(hidden) || 0
  const eye = n > 0
  return {
    label: all ? 'All' : 'Filtered',
    eye,
    aria: all ? 'HUD shows all receptions'
      : eye ? `HUD shows filtered receptions, ${n} hidden since this one` : 'HUD shows filtered receptions',
    title: eye ? `${n} receptions outside the filter since this one` : '',
  }
}

// hudActions: which of the three quick actions apply to the shown sender.
// Target and Add follow the target list's own rule (isTargetKind): a 1-byte
// hash names 256 nodes and cannot be a target. Ignore only needs an id, which
// is what the map popup offers for the same reception. `selected` and
// `ignored` are sets of lowercased ids. Add is one word because the row has
// to hold five controls at 360 px (#555).
export function hudActions(rec, { selected, ignored } = {}) {
  const id = rec && rec.sender_id != null ? String(rec.sender_id).toLowerCase() : ''
  const targetable = !!id && isTargetKind(rec.sender_kind)
  const isSelected = !!id && !!selected && selected.has(id)
  const isIgnored = !!id && !!ignored && ignored.has(id)
  return {
    target: { enabled: targetable, active: isSelected, label: 'Target' },
    add: { enabled: targetable, active: isSelected, label: 'Add' },
    // The label does not change with the state: the active colour is the
    // trace, and a wider word would push the row past 360 px.
    ignore: { enabled: !!id, active: isIgnored, label: 'Ignore' },
  }
}
