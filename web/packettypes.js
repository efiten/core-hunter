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
export function packetTypeLabel(rawType) {
  return FILTER_PACKET_TYPES.find((t) => t.value === rawType)?.label ?? rawType
}

export { FILTER_PACKET_TYPES }
