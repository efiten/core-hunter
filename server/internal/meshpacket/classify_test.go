package meshpacket

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type classifyCase struct {
	Raw         string `json:"raw"`
	PacketType  string `json:"packet_type"`
	Hops        int    `json:"hops"`
	IsDirect    bool   `json:"is_direct"`
	SenderKind  string `json:"sender_kind"`
	SenderID    string `json:"sender_id"`
	SenderLabel string `json:"sender_label"`
	SenderRole  string `json:"sender_role"`
}

func loadClassifyCases(t *testing.T) []classifyCase {
	t.Helper()
	data, err := os.ReadFile("testdata/classify_app.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []classifyCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	return cases
}

func TestClassifyMatchesTheApp(t *testing.T) {
	cases := loadClassifyCases(t)
	if len(cases) < 190 {
		t.Fatalf("fixture has %d entries, want at least 190", len(cases))
	}
	for _, c := range cases {
		want := Classification{c.PacketType, c.Hops, c.IsDirect, c.SenderKind, c.SenderID, c.SenderLabel, c.SenderRole}
		if got := Classify(c.Raw); got != want {
			t.Errorf("raw %s\n got  %+v\n want %+v", c.Raw, got, want)
		}
	}
}

func TestClassifyRefusesAForgedAdvert(t *testing.T) {
	for _, c := range loadClassifyCases(t) {
		if c.SenderKind != "advert_pubkey" {
			continue
		}
		if got := Classify(c.Raw); got.SenderKind != "advert_pubkey" {
			t.Fatalf("unflipped frame gave %+v", got)
		}
		b, err := hex.DecodeString(c.Raw)
		if err != nil {
			t.Fatal(err)
		}
		b[40] ^= 0x01 // inside the signature, payload offset 40
		got := Classify(hex.EncodeToString(b))
		want := Classification{PacketType: "Advert", Hops: 0, IsDirect: true}
		if got != want {
			t.Fatalf("got %+v, want %+v", got, want)
		}
		return
	}
	t.Fatal("fixture has no advert_pubkey frame")
}

func TestClassifyUndecodable(t *testing.T) {
	for _, raw := range []string{"", "zz", "01", "00aa", "11c1aabbccdd", "1103aabb"} {
		if got := Classify(raw); got != (Classification{PacketType: "Unknown"}) {
			t.Errorf("%q: got %+v", raw, got)
		}
	}
}

func TestClassifyUnknownPayloadType(t *testing.T) {
	got := Classify("3100aa")
	if got != (Classification{PacketType: "Unknown (0xc)"}) {
		t.Fatalf("got %+v", got)
	}
}

// Vectors are Node TextDecoder output, the app's reading of an advert name.
func TestAdvertNameDecodesLikeTextDecoder(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"41e28241", "A�A"},
		{"41ff41", "A�A"},
		{"41fffe41", "A��A"},
		{"41c041", "A�A"},
		{"41eda080", "A���"},
		{"41f0908041", "A�A"},
		{"41e2", "A�"},
		{"41f4908080", "A����"},
	} {
		b, _ := hex.DecodeString(c.in)
		if got := decodeUTF8(b); got != c.want {
			t.Errorf("%s: got %q want %q", c.in, got, c.want)
		}
	}
}
