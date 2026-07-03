package httpapi

import (
	"math"
	"testing"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

func TestSnap(t *testing.T) {
	if got := snap(51.23456); math.Abs(got-51.23) > 1e-9 {
		t.Fatalf("snap wrong: %v", got)
	}
}

func TestDegradePoints(t *testing.T) {
	ps := auth.Pseudonyms{"aaaa": 1, "bbbb": 2}
	pts := []store.Point{
		{Lat: 51.23456, Lon: 4.98765, HunterPubkey: "aaaa", HunterName: "Alice", SenderID: "s1"},
		{Lat: 52.11111, Lon: 5.22222, HunterPubkey: "bbbb", HunterName: "Bob", SenderID: "s2"},
	}
	own := map[string]bool{"aaaa": true} // caller owns aaaa
	out := degradePoints(pts, ps, own)
	// owned row untouched
	if out[0].HunterName != "Alice" || out[0].Lat != 51.23456 {
		t.Fatalf("owned row degraded: %+v", out[0])
	}
	// other row snapped + pseudonymised, sender kept
	if out[1].HunterPubkey != "h2" || out[1].HunterName != "Hunter 2" {
		t.Fatalf("other row not pseudonymised: %+v", out[1])
	}
	if math.Abs(out[1].Lat-52.11) > 1e-9 || out[1].SenderID != "s2" {
		t.Fatalf("other row not snapped / sender lost: %+v", out[1])
	}
}

func TestPseudonymiseHunters(t *testing.T) {
	ps := auth.Pseudonyms{"aaaa": 1, "bbbb": 2}
	hs := []store.Hunter{
		{Pubkey: "aaaa", Name: "Alice", Count: 10},
		{Pubkey: "bbbb", Name: "Bob", Count: 5},
	}
	// guest: empty own set -> all pseudonymised, counts kept
	g := pseudonymiseHunters(hs, ps, nil)
	if g[0].Pubkey != "h1" || g[0].Name != "Hunter 1" || g[0].Count != 10 {
		t.Fatalf("guest hunter not pseudonymised: %+v", g[0])
	}
	// hunter: own entry real, others pseudonymised
	h := pseudonymiseHunters(hs, ps, map[string]bool{"aaaa": true})
	if h[0].Pubkey != "aaaa" || h[0].Name != "Alice" {
		t.Fatalf("own hunter should stay real: %+v", h[0])
	}
	if h[1].Pubkey != "h2" {
		t.Fatalf("other hunter should be pseudonymised: %+v", h[1])
	}
}

// TestPseudonymiseHuntersMultipleOwn: a caller with multiple own companions
// must see ALL of them real, not just the first.
func TestPseudonymiseHuntersMultipleOwn(t *testing.T) {
	ps := auth.Pseudonyms{"aaaa": 1, "bbbb": 2, "cccc": 3}
	hs := []store.Hunter{
		{Pubkey: "aaaa", Name: "Alice", Count: 10},
		{Pubkey: "bbbb", Name: "Bob", Count: 5},
		{Pubkey: "cccc", Name: "Carol", Count: 1},
	}
	h := pseudonymiseHunters(hs, ps, map[string]bool{"aaaa": true, "bbbb": true})
	if h[0].Pubkey != "aaaa" || h[0].Name != "Alice" {
		t.Fatalf("own hunter aaaa should stay real: %+v", h[0])
	}
	if h[1].Pubkey != "bbbb" || h[1].Name != "Bob" {
		t.Fatalf("own hunter bbbb should stay real: %+v", h[1])
	}
	if h[2].Pubkey != "h3" {
		t.Fatalf("other hunter should be pseudonymised: %+v", h[2])
	}
}
