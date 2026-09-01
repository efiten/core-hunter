// One rule for every chip row on both surfaces (#564).
//
// A chip row filters one dimension, and "everything" has to have exactly one
// representation on screen. The app has said that with an explicit All chip
// since #475. The map wrote the same state as *nothing selected* -- correct in
// the query it built, and invisible to the reader, who saw a row of chips none
// of which was lit and no statement about what that meant.
//
// The selection is a Set of values, and the empty Set IS All. That keeps the
// two readings of "no chips active" from ever diverging again: there is one
// state, and the All chip is how it is drawn.
//
// Pure and DOM-free so both surfaces can call it and so it can be tested
// without a browser (there is no jsdom in this suite -- see focustrap.test.js).
// Copied into app/src/chiprow.js verbatim; web/parity.test.js pins the two.

export const ALL = 'all'

export function nextChipSelection(current, clicked) {
  const next = new Set(current || [])
  if (clicked === ALL) return new Set()
  if (next.has(clicked)) next.delete(clicked)
  else next.add(clicked)
  return next
}

// How many chips the "+N more" collapse is hiding (#564).
//
// Below the collapse the row shows the first `cap` chips plus every active one,
// whatever its position: an active filter the reader cannot see is the thing
// the panel exists to prevent. So the hidden ones are exactly the chips past
// the cap that are not selected.
//
// The map counted these by measuring -- `offsetWidth === 0` on every chip --
// which answers correctly only after layout, and answers zero before it. The
// count is a property of the list and the selection, so it is computed from
// them on both surfaces now.
export const CHIP_CAP = 6

export function hiddenChipCount(values, selected, cap = CHIP_CAP) {
  const sel = new Set(selected || [])
  return [...(values || [])].slice(cap).filter((v) => !sel.has(v)).length
}
