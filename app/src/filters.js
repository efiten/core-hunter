// The app's out-of-the-box filter — the baseline the active-indicator compares
// against. Kept here as the single source of truth so app.js and isFilterActive
// can never drift apart.
export const DEFAULT_FILTER = { sender: null, types: null, windowMs: 1800000, directOnly: false }

// isFilterActive reports whether the current filter differs from DEFAULT_FILTER,
// i.e. the user has narrowed something. Drives the filter button's active state.
export function isFilterActive(filter) {
  if (!filter) return false
  if (filter.sender && filter.sender.ids && filter.sender.ids.length) return true
  if (filter.directOnly !== DEFAULT_FILTER.directOnly) return true
  if (filter.windowMs !== DEFAULT_FILTER.windowMs) return true
  if (filter.types && [...filter.types].length > 0) return true
  return false
}

// Friendly labels for the decoder's raw packet_type values — shared by the
// filter chips, the receptions log, and map popups so the same reception
// reads the same way everywhere (#174).
//
// Carries the decoder's FULL PayloadType set, pinned by a unit test: a type
// that is captured but has no chip cannot be filtered for at all, and the
// types missing before #341 were not rare — Control, Path and AnonRequest are
// 22% of production receptions on their own.
export const FILTER_PACKET_TYPES = [
  { value: 'Advert',      label: 'Advert' },
  { value: 'GroupText',   label: 'Channel' },
  { value: 'GroupData',   label: 'Channel data' },
  { value: 'Response',    label: 'Response' },
  { value: 'Request',     label: 'Request' },
  { value: 'AnonRequest', label: 'Anon req' },
  { value: 'TextMessage', label: 'Direct msg' },
  { value: 'Ack',         label: 'Ack' },
  { value: 'Control',     label: 'Control' },
  { value: 'Path',        label: 'Path' },
  { value: 'Multipart',   label: 'Multipart' },
  { value: 'Trace',       label: 'Trace' },
  { value: 'RawCustom',   label: 'Raw' },
]

export function packetTypeLabel(rawType) {
  return FILTER_PACKET_TYPES.find((t) => t.value === rawType)?.label ?? rawType
}

export function makeFilter(opts) {
  const { sender, types, windowMs, directOnly, ignore } = opts
  // Target selection is a set of sender ids — the map/Locate run over their
  // union (OR). An empty/absent set means no sender filter (see #178).
  const wantIds = sender && Array.isArray(sender.ids) && sender.ids.length
    ? new Set(sender.ids.map((x) => String(x).toLowerCase()))
    : null
  return (rec, nowMs) => {
    // direct = zero-hop from the original sender. rec.is_direct is unusable
    // here: it is also true for relayed FLOOD packets (we hear the last relay
    // directly), so every captured record has it set (#138).
    if (directOnly && rec.hops !== 0) return false
    const id = rec.sender_id != null ? String(rec.sender_id).toLowerCase() : null
    if (wantIds && (id == null || !wantIds.has(id))) return false
    if (types && !types.has(rec.packet_type)) return false
    if (windowMs != null) {
      const age = nowMs - Date.parse(rec.rx_at)
      if (!(age <= windowMs)) return false
    }
    if (ignore && id != null && ignore.has(id)) return false
    return true
  }
}
