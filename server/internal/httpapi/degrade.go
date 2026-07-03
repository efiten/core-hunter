package httpapi

import (
	"math"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

const (
	guestWindow      = 24 * time.Hour
	guestPointCap    = 500
	guestSnapDeg     = 0.01
	guestHeatmapMaxZ = 12
)

func snap(x float64) float64 { return math.Round(x/guestSnapDeg) * guestSnapDeg }

func windowFrom(now time.Time) string {
	return now.Add(-guestWindow).UTC().Format(time.RFC3339)
}

// degradePoints degrades every row not owned by the caller: applies window+cap
// upstream (done in the query), then snaps coords and swaps hunter id/name for a
// pseudonym. own = set of the caller's companion pubkeys (nil for guest).
func degradePoints(pts []store.Point, ps auth.Pseudonyms, own map[string]bool) []store.Point {
	out := make([]store.Point, len(pts))
	for i, p := range pts {
		if own[p.HunterPubkey] {
			out[i] = p
			continue
		}
		p.Lat = snap(p.Lat)
		p.Lon = snap(p.Lon)
		p.HunterName = ps.Name(p.HunterPubkey)
		p.HunterPubkey = ps.Token(p.HunterPubkey)
		out[i] = p
	}
	return out
}

func pseudonymiseHunters(hs []store.Hunter, ps auth.Pseudonyms, own map[string]bool) []store.Hunter {
	out := make([]store.Hunter, len(hs))
	for i, h := range hs {
		if own[h.Pubkey] {
			out[i] = h
			continue
		}
		out[i] = store.Hunter{Pubkey: ps.Token(h.Pubkey), Name: ps.Name(h.Pubkey), Count: h.Count}
	}
	return out
}
