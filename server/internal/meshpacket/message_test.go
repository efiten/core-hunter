package meshpacket

import "testing"

// Every frame below is real, taken from the store, and every expected value was
// derived with a second implementation rather than by running this one. A test
// that only asserts "the four copies agree" passes just as well when the whole
// header is misread, which is how the first version of this file let four
// separate mutations through.
var frames = []struct {
	raw   string
	id    string
	hops  int
	label string
}{
	// The Amsterdam flood of 2026-08-24, one message heard four times. The
	// payload is identical and the path grows: `0426a364` is the prefix the
	// sender invented, everything after it was appended by a relay.
	{"0822480000040426a364fc64fd478be84632b802c7498e0db5334d2910e2", "da3fa49599d5bd27", 4, "as it left the sender"},
	{"0822480000050426a36431fc64fd478be84632b802c7498e0db5334d2910e2", "da3fa49599d5bd27", 5, "one relay on"},
	{"0822480000060426a3641c57fc64fd478be84632b802c7498e0db5334d2910e2", "da3fa49599d5bd27", 6, "two relays, one branch"},
	{"0822480000060426a3643124fc64fd478be84632b802c7498e0db5334d2910e2", "da3fa49599d5bd27", 6, "two relays, another branch"},

	// A 2-byte path hash. With the hash SIZE ignored the payload would start
	// at byte 7 instead of 12, which still decodes -- into a different id.
	{"1145dcdc79a46b8c7a7a49a9bbb09e99f12449f72d2ebd9c54e21602d40ba3bd", "87abb9822d83f081", 5, "advert, 2-byte hashes"},
	// A 3-byte path hash, same trap one size further out.
	{"0986c600089812266e56d12fba1c57b4434e172e77cc183d4cf0fcfa19e86ffc", "ba5e40021466cc82", 6, "text, 3-byte hashes"},
	// TRANSPORT_FLOOD, so four bytes of transport codes sit between the header
	// and path_len. Skipping them wrongly still produces a valid-looking parse
	// here (an empty payload), which is why the id is asserted and not just ok.
	{"108ae6000002a0231275abe28cecf76a3258ee659b63c1d393a277ebc7df8645", "d2e33e2a033fe968", 2, "advert, transport codes"},
}

func TestMessageIDReadsEveryHeaderShape(t *testing.T) {
	for _, f := range frames {
		got, ok := MessageID(f.raw)
		if !ok {
			t.Fatalf("%s: refused a frame that decodes", f.label)
		}
		if got != f.id {
			t.Fatalf("%s: got %q, want %q", f.label, got, f.id)
		}
	}
}

func TestMessageIDIgnoresTheRouteACopyTook(t *testing.T) {
	// The property the whole feature rests on: four different frames, one
	// transmission. If the path leaked into the hash these would be four
	// unrelated groups and a flood with no sender would stay unfilterable --
	// which is the state this exists to fix.
	for _, f := range frames[1:4] {
		got, _ := MessageID(f.raw)
		if got != frames[0].id {
			t.Fatalf("%s: got %q, want the same id as the sender's own copy %q", f.label, got, frames[0].id)
		}
	}
}

func TestMessageIDSeparatesDifferentMessages(t *testing.T) {
	// Same sender, same route type, different payload -- another frame from
	// the same flood. Merging these would collapse the flood into one blob and
	// destroy the per-message evidence the origin-copy rule needs.
	other, ok := MessageID("0886c0000008150c287e99644c9a5107765f7144c2bbc36cc7e8f19af9b8")
	if !ok || other == frames[0].id {
		t.Fatalf("distinct payloads must not share an id: %q", other)
	}
}

func TestMessageIDRefusesATraceItCouldOtherwiseAnswer(t *testing.T) {
	// A well-formed TRACE: route 2, no transport codes, one 1-byte hash, and a
	// payload that hashes to e9680be76bec2982 if you let it. It is refused
	// because the firmware hashes path_len into a TRACE's identity -- its
	// copies are not interchangeable, so grouping them would disagree with
	// MeshCore itself. The fixture decodes cleanly on purpose: a malformed one
	// would be rejected for the wrong reason and pin nothing.
	if id, ok := MessageID("26011c77c54b17000000000064"); ok {
		t.Fatalf("a TRACE has no cross-copy identity, got %q", id)
	}
}

func TestMessageIDRefusesWhatItCannotRead(t *testing.T) {
	// A truncated frame must not hash whatever bytes are left: that files
	// unrelated receptions under one plausible-looking id.
	for _, bad := range []string{"", "0", "zz", "08", "0822480000", "08224800003f", "1145dc"} {
		if id, ok := MessageID(bad); ok {
			t.Fatalf("%q should not decode, got %q", bad, id)
		}
	}
}

func TestMessageIDIsSixteenLowercaseHex(t *testing.T) {
	id, _ := MessageID(frames[0].raw)
	if len(id) != 16 {
		t.Fatalf("id %q has length %d, want 16", id, len(id))
	}
	for _, r := range id {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Fatalf("id %q is not lowercase hex", id)
		}
	}
}

func TestPathHashCountMatchesWhatTheAppReported(t *testing.T) {
	// Pinned against the `hops` the app stored for these same frames. The
	// 2-byte fixture is what makes the mask load-bearing: its path_len byte is
	// 0x45, so an unmasked read answers 69 instead of 5.
	for _, f := range frames {
		got, ok := PathHashCount(f.raw)
		if !ok || got != f.hops {
			t.Fatalf("%s: got %d ok=%v, want %d", f.label, got, ok, f.hops)
		}
	}
	for _, bad := range []string{"", "zz", "08", "0822"} {
		if _, ok := PathHashCount(bad); ok {
			t.Fatalf("%q should not decode", bad)
		}
	}
}
