// Same packet-type set as the app's filter sheet (parity, #142). Split out of
// filters.js into its own side-effect-free module: filters.js has top-level
// DOM side effects (loadHunters()), so an import from map.js would otherwise
// instantiate a second copy of it under a different resolved URL than the
// cache-busted <script> tag, double-running that side effect (#174 review).
const FILTER_PACKET_TYPES = [
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
  // Not a decoder type: what the hunter app files a packet under when it did
  // not decode at all (#454). The reception is real, so it filters like any
  // other type — including through ?types=Unknown on the server query.
  { value: 'Unknown',     label: 'Unknown' },
]

// Friendly label for a raw decoder packet_type — same mapping as the filter
// chips, reused so map popups and other displays read the same way (#174).
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

export { FILTER_PACKET_TYPES }
