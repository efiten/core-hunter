// Package meshpacket reads the parts of a MeshCore frame that identify a
// transmission, independently of the route it took to reach us.
package meshpacket

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Header layout, from firmware src/Packet.h and Packet.cpp writeTo():
//
//	byte 0        header: route in bits 0-1, payload type in bits 2-5
//	bytes 1-4     transport codes, present ONLY on the two transport routes
//	next byte     path_len: hash size in bits 6-7 (+1), hash count in bits 0-5
//	then          path, hashSize * hashCount bytes
//	then          payload
//
// The transport codes are easy to miss and shift everything after them: read
// path_len at a fixed offset and a transport-routed packet decodes as garbage.
const (
	routeMask            = 0x03
	routeTransportFlood  = 0x00
	routeTransportDirect = 0x03
	typeShift            = 2
	typeMask             = 0x0F
	payloadTypeTrace     = 0x09
)

// MessageID is MeshCore's own notion of "this is the same transmission",
// ported from Packet::calculatePacketHash (firmware src/Packet.cpp:41):
//
//	SHA256( payloadType || payload )
//
// The path is deliberately not in it, which is exactly the property this is
// wanted for. A relay appends its own hash before forwarding, so every copy of
// one transmission has a different path and an identical payload — and a
// sender that cannot be named still leaves receptions that group together.
//
// That matters because the alternative handle does not exist. A flood sent with
// 1-byte path hashes carries no attributable sender at all (classifyReception
// refuses a 1-byte prefix, 1-in-256), so on 2026-08-24 an Amsterdam hunt saw
// 2,707 receptions with an empty sender and no way to filter to them. This is
// the handle that was missing.
//
// Truncated to 16 hex characters. The full digest is a 64-character column on
// every row for a value only ever compared for equality; 64 bits leaves a
// collision chance around one in a billion at the sizes this store reaches, and
// a collision merges two message streams rather than corrupting a measurement.
//
// TRACE is refused rather than answered. The firmware hashes path_len into a
// TRACE's own identity (`if (t == PAYLOAD_TYPE_TRACE) sha.update(&path_len...)`)
// precisely because its copies are NOT interchangeable — it revisits nodes on
// the return path. Answering anyway would group things MeshCore considers
// distinct, so the honest answer is that a TRACE has no cross-copy identity.
func MessageID(rawHex string) (string, bool) {
	b, err := hex.DecodeString(strings.TrimSpace(rawHex))
	if err != nil || len(b) < 2 {
		return "", false
	}
	route := b[0] & routeMask
	payloadType := (b[0] >> typeShift) & typeMask
	if payloadType == payloadTypeTrace {
		return "", false
	}
	i := 1
	if route == routeTransportFlood || route == routeTransportDirect {
		i += 4
	}
	if len(b) <= i {
		return "", false
	}
	pathLen := b[i]
	i++
	i += int(pathLen>>6+1) * int(pathLen&0x3F) // hash size * hash count
	if i > len(b) {
		return "", false
	}
	h := sha256.New()
	h.Write([]byte{payloadType})
	h.Write(b[i:])
	return hex.EncodeToString(h.Sum(nil))[:16], true
}

// PathHashCount is how many relay hashes the frame carries. It is the number
// the app reports as `hops`, and on its own it is worthless: the sender writes
// the path, so a spammer can pre-fill it — the same Amsterdam flood claimed 1
// to 37 hops for packets received directly, which is why "direct only"
// (hops == 0) hid every one of them.
//
// What survives forgery is the DIFFERENCE between copies of one message. The
// originator's own transmission carries whatever prefix it invented; each relay
// appends to it. So within a message id, the copies with the FEWEST hashes are
// the ones that reached us with the fewest real forwards — measured over that
// hunt, they ran 19 dB stronger in the median than the longer-path copies.
//
// This assumes relays append honestly, which is a far weaker assumption than
// trusting the count itself: it is broken by a malicious relay, not by the
// sender we are hunting.
func PathHashCount(rawHex string) (int, bool) {
	b, err := hex.DecodeString(strings.TrimSpace(rawHex))
	if err != nil || len(b) < 2 {
		return 0, false
	}
	i := 1
	if r := b[0] & routeMask; r == routeTransportFlood || r == routeTransportDirect {
		i += 4
	}
	if len(b) <= i {
		return 0, false
	}
	return int(b[i] & 0x3F), true
}
