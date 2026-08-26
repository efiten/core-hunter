// The app's out-of-the-box filter — the baseline the active-indicator compares
// against. Kept here as the single source of truth so app.js and isFilterActive
// can never drift apart.
export const DEFAULT_FILTER = { sender: null, types: null, windowMs: 1800000, directOnly: false, unnamed: false, idClasses: null }

// isFilterActive reports whether the current filter differs from DEFAULT_FILTER,
// i.e. the user has narrowed something. Drives the filter button's active state.
export function isFilterActive(filter) {
  if (!filter) return false
  if (filter.sender && filter.sender.ids && filter.sender.ids.length) return true
  if (filter.directOnly !== DEFAULT_FILTER.directOnly) return true
  if (filter.unnamed !== DEFAULT_FILTER.unnamed) return true
  if (filter.windowMs !== DEFAULT_FILTER.windowMs) return true
  if (filter.types && [...filter.types].length > 0) return true
  if (filter.idClasses && [...filter.idClasses].length > 0) return true
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
  // Not a decoder type: what the capture path files a packet under when it did
  // not decode at all (#454). The reception is real — the 0x88 frame's RSSI and
  // SNR are read before decoding — so it needs a chip like every other type,
  // or it is hidden the moment any chip is touched (#341).
  { value: 'Unknown',     label: 'Unknown' },
]

// Sender-id classes (#475). The bucket is the byte length of sender_id, which
// is a direct reading of how well the sender can be identified at all: one
// byte is a 1-in-256 guess, a pubkey is effectively unique. It cuts across
// sender_kind on purpose -- a 1-byte id is the same 256-way space whether it
// arrived as a DIRECT source hash or a FLOOD path hash (#521).
//
// This is the axis that isolates a flood. Before #521 those receptions had no
// sender at all, so "Unnamed" caught them; they carry a byte now, so nothing
// did until this. On the 2026-08-24 hunt the class held 88% of the window.
//
// Channel is the one bucket that is not a length: a decrypted channel sender
// is a display name, not hex, so it is decided by kind before anything is
// measured.
export const SENDER_ID_CLASSES = [
  { value: 'unnamed', label: 'Unnamed' },
  { value: '1b',      label: '1 byte'  },
  { value: '2b',      label: '2 bytes' },
  { value: '3b',      label: '3 bytes' },
  { value: 'pubkey',  label: 'Pubkey'  },
  { value: 'channel', label: 'Channel' },
]

// senderIdClass buckets one reception. Mirrored in SQL by the server, which
// filters the map's rows server-side (server/internal/store/query.go); the two
// have to agree bucket for bucket or the same reception lands in different
// chips on the two surfaces.
export function senderIdClass(rec) {
  if (!rec) return 'unnamed'
  if (rec.sender_kind === 'channel_name') return 'channel'
  const id = rec.sender_id == null ? '' : String(rec.sender_id)
  if (!id) return 'unnamed'
  if (id.length === 2) return '1b'
  if (id.length === 4) return '2b'
  if (id.length === 6) return '3b'
  return 'pubkey'
}

export function packetTypeLabel(rawType) {
  return FILTER_PACKET_TYPES.find((t) => t.value === rawType)?.label ?? rawType
}

export function makeFilter(opts) {
  const { sender, types, windowMs, directOnly, unnamed, idClasses, ignore } = opts
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
    const id = rec.sender_id != null && rec.sender_id !== '' ? String(rec.sender_id).toLowerCase() : null
    // Everything the classifier could not attribute. Not an error state: since
    // #455 an unattributable reception is still a real measurement, and a flood
    // sent with 1-byte path hashes leaves nothing else to filter on (#501).
    if (unnamed && id != null) return false
    if (wantIds && (id == null || !wantIds.has(id))) return false
    // Sender-id class (#475): the axis that isolates a flood, now that those
    // receptions carry a byte and so no longer answer to `unnamed`.
    if (idClasses && !idClasses.has(senderIdClass(rec))) return false
    if (types && !types.has(rec.packet_type)) return false
    if (windowMs != null) {
      const age = nowMs - Date.parse(rec.rx_at)
      if (!(age <= windowMs)) return false
    }
    if (ignore && id != null && ignore.has(id)) return false
    return true
  }
}
