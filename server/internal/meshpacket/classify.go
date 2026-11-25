package meshpacket

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"
)

const (
	ptRequest     = 0x00
	ptResponse    = 0x01
	ptText        = 0x02
	ptAdvert      = 0x04
	ptGroupText   = 0x05
	ptControl     = 0x0B
	routeFlood    = 0x01
	advertMinLen  = 101 // pubkey 32 + timestamp 4 + signature 64 + flags 1
	discoverFlag  = 0x90
	discoverMin   = 14
	advertFlagLoc = 0x10
	advertFlagF1  = 0x20
	advertFlagF2  = 0x40
	advertFlagNam = 0x80
)

// Classification is what a frame says about who sent it.
type Classification struct {
	PacketType  string // the app's getPayloadTypeName, "Unknown" when the frame cannot be walked
	Hops        int
	IsDirect    bool
	SenderKind  string // "" | relay | path_hash | advert_pubkey | discover_pubkey | direct_hash
	SenderID    string
	SenderLabel string
	SenderRole  string
}

var payloadTypeNames = map[byte]string{
	0: "Request", 1: "Response", 2: "TextMessage", 3: "Ack", 4: "Advert",
	5: "GroupText", 6: "GroupData", 7: "AnonRequest", 8: "Path", 9: "Trace",
	10: "Multipart", 11: "Control", 15: "RawCustom",
}

// Classify reads a frame's sender from the frame alone. It is the server's
// port of classifyReception (app/src/meshpacket.js) plus the advert identity
// gate in app/src/app.js, so a reception that arrives without the app's
// reading gets the same one. There is no channel_name sender here: that needs
// the channel keys, which the server does not hold.
func Classify(rawHex string) Classification {
	route, ptype, hashSize, hops, path, payload, ok := walk(rawHex)
	if !ok {
		return Classification{PacketType: "Unknown"}
	}
	c := Classification{PacketType: typeName(ptype), Hops: hops}
	switch {
	case ptype == payloadTypeTrace:
		// the path bytes of a trace are SNR values, not hop hashes
	case hops > 0:
		if route == routeFlood || route == routeTransportFlood {
			last := path[len(path)-hashSize:]
			c.IsDirect = true
			c.SenderID = hex.EncodeToString(last)
			if hashSize >= 2 {
				c.SenderKind = "relay"
			} else {
				c.SenderKind = "path_hash"
				c.SenderLabel = c.SenderID
			}
		}
	default:
		c = classifyOrigin(c, ptype, payload)
	}
	return c
}

// walk is the decoder's reading of the header (route, type, path), which is
// stricter than MessageID's: it refuses hash size 4 and a truncated path.
func walk(rawHex string) (route, ptype byte, hashSize, hops int, path, payload []byte, ok bool) {
	b, err := hex.DecodeString(strings.TrimSpace(rawHex))
	if err != nil || len(b) < 2 {
		return
	}
	route = b[0] & routeMask
	ptype = (b[0] >> typeShift) & typeMask
	i := 1
	if route == routeTransportFlood || route == routeTransportDirect {
		if len(b) < 5 {
			return
		}
		i += 4
	}
	if len(b) <= i {
		return
	}
	pl := b[i]
	i++
	if pl>>6 == 3 {
		return
	}
	hashSize = int(pl>>6) + 1
	hops = int(pl & 0x3F)
	if i+hops*hashSize > len(b) {
		return
	}
	path = b[i : i+hops*hashSize]
	payload = b[i+hops*hashSize:]
	ok = true
	return
}

func typeName(t byte) string {
	if n, ok := payloadTypeNames[t]; ok {
		return n
	}
	return fmt.Sprintf("Unknown (0x%x)", t)
}

// classifyOrigin handles a frame heard with no relay in front of it, where the
// payload itself may name the sender.
func classifyOrigin(c Classification, ptype byte, p []byte) Classification {
	switch {
	case ptype == ptAdvert && len(p) >= advertMinLen:
		return classifyAdvert(c, p)
	case ptype == ptGroupText:
	case ptype == ptControl && len(p) >= discoverMin && p[0]&0xF0 == discoverFlag:
		c.IsDirect = true
		c.SenderKind = "discover_pubkey"
		c.SenderID = hex.EncodeToString(p[6:])
		c.SenderRole = discoverRole(p[0] & 0x0F)
	case (ptype == ptRequest || ptype == ptResponse || ptype == ptText) && len(p) >= 4:
		c.IsDirect = true
		c.SenderKind = "direct_hash"
		c.SenderID = hex.EncodeToString(p[1:2])
		c.SenderLabel = c.SenderID
	}
	return c
}

func discoverRole(n byte) string {
	switch n {
	case 0:
		return "Unknown"
	case 1:
		return "Chat Node"
	case 2:
		return "Repeater"
	case 3:
		return "Room Server"
	case 4:
		return "Sensor"
	}
	return fmt.Sprintf("Unknown (%d)", n)
}

// classifyAdvert names the sender from the advert and then checks the
// signature. An advert that does not verify is a made-up identity: the
// reception stays (its signal is ours) and everything the packet claimed about
// itself goes.
func classifyAdvert(c Classification, p []byte) Classification {
	if !ed25519.Verify(p[0:32], append(append([]byte{}, p[0:36]...), p[100:]...), p[36:100]) {
		c.IsDirect = true
		return c
	}
	flags := p[100]
	c.IsDirect = true
	c.SenderKind = "advert_pubkey"
	c.SenderID = hex.EncodeToString(p[0:32])
	switch flags & 0x0F {
	case 2:
		c.SenderRole = "Repeater"
	case 3:
		c.SenderRole = "Room Server"
	case 4:
		c.SenderRole = "Sensor"
	default:
		c.SenderRole = "Chat Node"
	}
	off := advertMinLen
	if flags&advertFlagLoc != 0 && len(p)-off >= 8 {
		off += 8
	}
	if flags&advertFlagF1 != 0 {
		off += 2
	}
	if flags&advertFlagF2 != 0 {
		off += 2
	}
	if flags&advertFlagNam != 0 && off < len(p) {
		c.SenderLabel = advertLabel(p[off:])
	}
	return c
}

// advertLabel is the name as the app shows it: cut at the first NUL, trimmed,
// control characters removed, falling back to the cut name when that empties it.
func advertLabel(raw []byte) string {
	name := strings.ToValidUTF8(string(raw), "�")
	if i := strings.IndexByte(name, 0); i >= 0 {
		name = name[:i]
	}
	cleaned := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7F {
			return -1
		}
		return r
	}, strings.TrimFunc(name, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF }))
	if cleaned != "" {
		return cleaned
	}
	return name
}
