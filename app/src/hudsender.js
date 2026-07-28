// Who the last reception was heard from, for the HUD readout.
// classifyReception() already resolves `sender` to the immediate transmitter —
// the originating node at zero hops, or a FLOOD packet's last relay — so a
// 'relay' kind is exactly the last-hop repeater we heard, not the origin.
const ID_PREFIX_LEN = 6

export function senderReadout(rec) {
  if (!rec) return { text: '—', viaRelay: false }
  // For a DIRECT packet, meshpacket.js sets sender_label to the 2-hex source
  // hash itself, so taking the label branch would print e.g. "4a" — visually
  // identical to a resolved short name. That id is a 256-way collision space:
  // feed.js excludes direct_hash from TARGET_KINDS and names.js refuses to
  // resolve 2-hex ids, both for that reason, so the HUD would be the only
  // surface presenting one as an identity. Marked with # instead, the house
  // style for "this is an id, and not a resolved one".
  const isDirectHash = rec.sender_kind === 'direct_hash'
  const label = !isDirectHash && typeof rec.sender_label === 'string' ? rec.sender_label.trim() : ''
  const id = typeof rec.sender_id === 'string' ? rec.sender_id.trim() : ''
  const name = label || (id ? (isDirectHash ? '#' : '') + id.slice(0, ID_PREFIX_LEN) : '')
  if (!name || name === '#') return { text: '—', viaRelay: false }
  const viaRelay = rec.sender_kind === 'relay'
  return { text: viaRelay ? `via ${name}` : name, viaRelay }
}
