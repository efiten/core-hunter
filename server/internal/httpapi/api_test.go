package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
	"github.com/efiten/core-hunter/server/internal/version"
)

func TestParseBBox(t *testing.T) {
	a, b, c, d, ok := ParseBBox("51.0,4.0,52.0,5.0")
	if !ok || a != 51.0 || b != 4.0 || c != 52.0 || d != 5.0 { t.Fatalf("good bbox parsed wrong: %v %v %v %v %v", a, b, c, d, ok) }
	if _, _, _, _, ok := ParseBBox("nope"); ok { t.Fatal("bad bbox accepted") }
	if _, _, _, _, ok := ParseBBox("1,2,3"); ok { t.Fatal("short bbox accepted") }
}

func TestFilterFromHopsAndTypes(t *testing.T) {
	// hops + comma-separated types parsed into the store filter (#142)
	r := httptest.NewRequest(http.MethodGet, "/api/points?hops=0&types=Advert,GroupText", nil)
	f := filterFrom(r, nil)
	if f.Hops == nil || *f.Hops != 0 { t.Fatalf("hops not parsed: %+v", f.Hops) }
	if len(f.Types) != 2 || f.Types[0] != "Advert" || f.Types[1] != "GroupText" { t.Fatalf("types not parsed: %+v", f.Types) }
	// absent params → no hop filter, no type filter
	r = httptest.NewRequest(http.MethodGet, "/api/points", nil)
	f = filterFrom(r, nil)
	if f.Hops != nil || len(f.Types) != 0 { t.Fatalf("empty params must not filter: hops=%v types=%v", f.Hops, f.Types) }
	// junk hops → ignored, not a filter
	r = httptest.NewRequest(http.MethodGet, "/api/points?hops=abc", nil)
	f = filterFrom(r, nil)
	if f.Hops != nil { t.Fatalf("junk hops must be ignored: %v", *f.Hops) }
}

func TestVersionEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, nil, nil, nil, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if rec.Code != http.StatusOK { t.Fatalf("status = %d, want 200", rec.Code) }
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil { t.Fatalf("bad json: %v", err) }
	if body["server"] != version.Version { t.Fatalf("server = %q, want %q", body["server"], version.Version) }
}

func seedPointsStore(t *testing.T) *store.Store {
	st, _ := store.Open(":memory:")
	recent := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	old := time.Now().Add(-72 * time.Hour).UTC().Format(time.RFC3339)
	st.Insert(store.Reception{HunterPubkey: "aaaa", HunterName: "Alice", RxAt: recent, RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.23456, Lon: 4.98765, SenderID: "s1", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "bbbb", HunterName: "Bob", RxAt: recent, RSSI: -80, Raw: "00", IsDirect: true, Lat: 52.11111, Lon: 5.22222, SenderID: "s2", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "bbbb", HunterName: "Bob", RxAt: old, RSSI: -80, Raw: "00", IsDirect: true, Lat: 52.0, Lon: 5.0, SenderID: "s3", PacketType: "Response"})
	return st
}

func doPoints(t *testing.T, st *store.Store, a Auth) map[string]any {
	return doPointsQ(t, st, a, "")
}

func doPointsQ(t *testing.T, st *store.Store, a Auth, query string) map[string]any {
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil) // new 5-arg signature (Task 21); nil AuthAPI OK for read routes
	r := httptest.NewRequest("GET", "/api/points"+query, nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func TestPointsGuestDegraded(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doPoints(t, st, Guest())
	pts := out["points"].([]any)
	// old (>24h) row filtered out -> only 2 recent
	if len(pts) != 2 {
		t.Fatalf("guest window should drop the old row, got %d", len(pts))
	}
	first := pts[0].(map[string]any)
	// snapped + pseudonymised
	if first["hunter_name"].(string)[:6] != "Hunter" {
		t.Fatalf("guest hunter not pseudonymised: %v", first["hunter_name"])
	}
	if first["hunter_pubkey"].(string)[0] != 'h' {
		t.Fatalf("guest pubkey should be a pseudonym token: %v", first["hunter_pubkey"])
	}
}

func TestPointsMemberFull(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doPoints(t, st, Auth{Role: "member", UserID: 1, Username: "m"})
	pts := out["points"].([]any)
	if len(pts) != 3 { // member sees old row too
		t.Fatalf("member should see all 3 rows, got %d", len(pts))
	}
}

func TestPointsHunterOwnExact(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	out := doPoints(t, st, a)
	pts := out["points"].([]any)
	for _, p := range pts {
		m := p.(map[string]any)
		if m["hunter_pubkey"] == "aaaa" && m["hunter_name"] != "Alice" {
			t.Fatalf("own row must stay exact: %v", m)
		}
		if m["hunter_pubkey"] == "h2" && m["hunter_name"] != "Hunter 2" {
			t.Fatalf("other row must be pseudonymised: %v", m)
		}
	}
}

// TestPointsGuestRawPubkeyIgnored: a guest passing a real, raw pubkey via
// ?hunter= must NOT get results filtered to just that hunter's rows -- that
// would deanonymize/target them. The degraded response must match the
// unfiltered guest view (both pseudonyms present).
func TestPointsGuestRawPubkeyIgnored(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	baseline := doPoints(t, st, Guest())
	basePts := baseline["points"].([]any)
	out := doPointsQ(t, st, Guest(), "?hunter=bbbb")
	pts := out["points"].([]any)
	if len(pts) != len(basePts) {
		t.Fatalf("raw pubkey must not narrow the guest view: got %d, want %d (unfiltered)", len(pts), len(basePts))
	}
	seen := map[string]bool{}
	for _, p := range pts {
		seen[p.(map[string]any)["hunter_pubkey"].(string)] = true
	}
	if len(seen) < 2 {
		t.Fatalf("raw pubkey must not target a single hunter, got pseudonyms: %v", seen)
	}
}

// TestPointsHunterOwnPubkeyFilter: a hunter filtering by their OWN raw pubkey
// is honoured (it's just a self filter, not cross-hunter targeting).
func TestPointsHunterOwnPubkeyFilter(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	out := doPointsQ(t, st, a, "?hunter=aaaa")
	pts := out["points"].([]any)
	if len(pts) != 1 {
		t.Fatalf("own-pubkey filter should return exactly the caller's own row, got %d", len(pts))
	}
	m := pts[0].(map[string]any)
	if m["hunter_pubkey"] != "aaaa" || m["hunter_name"] != "Alice" {
		t.Fatalf("own-pubkey filter must stay exact: %v", m)
	}
}

// TestPointsPseudonymTokenResolves: a guest filtering by a pseudonym token
// (h1) resolves to the ordinal-1 real hunter (aaaa) and the returned row is
// pseudonymised back to h1/"Hunter 1".
func TestPointsPseudonymTokenResolves(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doPointsQ(t, st, Guest(), "?hunter=h1")
	pts := out["points"].([]any)
	if len(pts) != 1 {
		t.Fatalf("pseudonym filter should resolve to exactly one hunter's rows, got %d", len(pts))
	}
	m := pts[0].(map[string]any)
	if m["hunter_pubkey"] != "h1" || m["hunter_name"] != "Hunter 1" {
		t.Fatalf("pseudonym-filtered row must stay pseudonymised: %v", m)
	}
}

// TestDegradeFilterCapClampsNegative: a negative (or zero, or over-cap) limit
// must always clamp to guestPointCap for a sub-member caller -- store.QueryPoints
// treats any <=0 limit as "use its own 5000 default", which would otherwise
// bypass the 500 guest cap entirely.
func TestDegradeFilterCapClampsNegative(t *testing.T) {
	now := time.Now()
	ps := auth.Pseudonyms{}
	for _, limit := range []int{-1, 0, 1000} {
		f := degradeFilter(store.Filter{Limit: limit}, Guest(), ps, now)
		if f.Limit != guestPointCap {
			t.Fatalf("Limit=%d: degradeFilter gave %d, want %d", limit, f.Limit, guestPointCap)
		}
	}
}
