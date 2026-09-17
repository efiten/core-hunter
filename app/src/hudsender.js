// Who the last reception was heard from, for the HUD readout.
// classifyReception() already resolves `sender` to the immediate transmitter —
// the originating node at zero hops, or a FLOOD packet's last relay — so a
// 'relay' kind is exactly the last-hop repeater we heard, not the origin.
import { isHashIdKind, nameParts } from './names.js'
import { packetTypeLabel } from './filters.js'

const ID_PREFIX_LEN = 6

// senderReadout returns the line as one string (`text`) and in the parts the
// HUD draws apart (#618): `prefix` ("via " and the guess mark, muted), `name`
// (text colour, cut from its end) and `note`, which stands alone, muted, when
// there is no sender to name. text is always prefix + name, or the note.
export function senderReadout(rec) {
  if (!rec) return noSender('No reception yet')
  // For a DIRECT packet, meshpacket.js sets sender_label to the 2-hex source
  // hash itself, so taking the label branch would print e.g. "4a" — visually
  // identical to a resolved short name. That id is a 256-way collision space:
  // feed.js excludes direct_hash from TARGET_KINDS and names.js refuses to
  // resolve 2-hex ids, both for that reason, so the HUD would be the only
  // surface presenting one as an identity. Marked with # instead, the house
  // style for "this is an id, and not a resolved one".
  // path_hash is the same shape as direct_hash: a 1-byte id, carried as its own
  // label, in a 256-way collision space. It arrives on a FLOOD path[last], so
  // it is still a relay we heard, and it reads "via #64".
  // What does name a hash id is its attribution by reach (#661): placed on the
  // one registry node in reach, it reads by that node's name ("via ~Name");
  // otherwise it keeps its # id. nameParts gives a hash id no name unless it
  // is placed, and drops a resolved relay name on a collision too.
  const isHashId = isHashIdKind(rec.sender_kind)
  const trimmed = typeof rec.sender_label === 'string' ? rec.sender_label.trim() : ''
  // nameParts carries the guess mark for a name on a short prefix (#452).
  const parts = nameParts({ ...rec, sender_label: trimmed })
  const id = typeof rec.sender_id === 'string' ? rec.sender_id.trim() : ''
  const name = parts.name || (id ? (isHashId ? '#' : '') + id.slice(0, ID_PREFIX_LEN) : '')
  if (!name || name === '#') {
    // No sender to name: say what was heard instead, in the packet-type words
    // the ticker's meta cell uses (a trace, an undecodable packet).
    const type = packetTypeLabel(rec.packet_type)
    return noSender(type ? `${type}, no sender id` : 'No sender id')
  }
  const viaRelay = rec.sender_kind === 'relay' || rec.sender_kind === 'path_hash'
  const prefix = (viaRelay ? 'via ' : '') + parts.mark
  return { text: prefix + name, viaRelay, prefix, name, note: '' }
}

function noSender(note) {
  return { text: note, viaRelay: false, prefix: '', name: '', note }
}
