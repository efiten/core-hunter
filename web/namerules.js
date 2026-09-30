// How a sender's name is printed (#452, #661, #663). Pure: no resolver, no
// cache, no config. Where a name comes from differs per surface (the app asks
// the registries of the companion's SF, the map asks the server's resolve
// proxy), how it reads does not.
// Copied whole between app/src/ and web/ (parity.test.js), since neither deploy
// path can ship a file outside its own directory (#238). No imports.

// A sender id of one byte (2 hex) is a 256-way collision space, so the id
// itself is never a name, and meshpacket.js carries it as its OWN sender_label
// for the two kinds below. A surface that prints that label unguarded shows
// "77" exactly as it would show a resolved short name. Marked with # instead,
// the house style hudsender.js set, and kept out of the resolver by the 4-hex
// floor. A name for it comes only from its attribution by reach (#661).
const HASH_ID_KINDS = ['direct_hash', 'path_hash']
export function isHashIdKind(kind) { return HASH_ID_KINDS.includes(kind) }

// A name resolved for a short prefix is a guess about who was heard: a 2- or
// 3-byte id is one in 65,536 or 16 million per registry, and a relay hash is
// the forwarder's, not a node id. The name stays (it is usually right, and
// the field reads by it) and wears GUESS_MARK on every surface, so nothing
// presents it as a resolved identity (#452). An advert's own name on its
// full key, a channel sender's name and an 8-byte discover prefix are not
// guesses; a 1-byte hash carries no resolved name (isHashIdKind), only the
// name of the node it is placed on by reach (displayName).
export const GUESS_MARK = '~'
const GUESS_MAX_HEX = 6
export function isGuessedName(rec) {
  if (!rec || !rec.sender_label) return false
  if (rec.sender_kind === 'channel_name' || isHashIdKind(rec.sender_kind)) return false
  const id = typeof rec.sender_id === 'string' ? rec.sender_id : ''
  return /^[0-9a-f]+$/i.test(id) && id.length <= GUESS_MAX_HEX
}

// nameParts: the name as a surface should print it, split into the guess mark
// and the name itself ({ mark: '', name: '' } when there is none), so the HUD
// can mute the mark and not the name (#618). displayName joins the two.
//
// A relay, path or direct hash of 1 to 3 bytes is named by its attribution by
// reach first (#661, attribution.js), which the surface puts on the row as
// _attr:
//   node       the one registry node in reach: that node's name, marked, since
//              the node is still a guess about who relayed; none if it has none
//   collision  two or more in reach: no name, whatever the resolver said
//   estimate   none in reach: the resolver's name as before, unless the
//              registry holds a positioned node with that prefix out of reach
//              (prefixKnown), which is evidence the name is that node's
// A 1-byte hash (isHashIdKind) is named only by a placement: meshpacket.js
// carries the hash as its own label, which is no name. Any other row without
// _attr (a kind the rule does not cover, or not worked out yet) reads by its
// label, as before.
const NO_NAME = Object.freeze({ mark: '', name: '' })
export function nameParts(rec) {
  if (!rec) return NO_NAME
  const attr = rec._attr
  if (attr && attr.rule === 'node') return attr.node && attr.node.name ? { mark: GUESS_MARK, name: String(attr.node.name) } : NO_NAME
  if (attr && attr.rule === 'collision') return NO_NAME
  if (isHashIdKind(rec.sender_kind)) return NO_NAME
  if (attr && attr.rule === 'estimate' && attr.prefixKnown) return NO_NAME
  if (!rec.sender_label) return NO_NAME
  return { mark: isGuessedName(rec) ? GUESS_MARK : '', name: String(rec.sender_label) }
}

// displayName: the name as one string, marked when guessed; '' when there is
// none, so callers fall back to the id as before.
export function displayName(rec) {
  const { mark, name } = nameParts(rec)
  return mark + name
}
