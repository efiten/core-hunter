package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

// TestFilterFromHunterCommaSeparated: ?hunter= accepts a comma-separated list
// (#196), trims whitespace, and an absent/empty param means no filter.
func TestFilterFromHunterCommaSeparated(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/points?hunter=aaaa,%20bbbb", nil)
	f := filterFrom(r, nil)
	if len(f.Hunter) != 2 || f.Hunter[0] != "aaaa" || f.Hunter[1] != "bbbb" {
		t.Fatalf("comma-separated hunter not parsed: %+v", f.Hunter)
	}
	r = httptest.NewRequest(http.MethodGet, "/api/points", nil)
	f = filterFrom(r, nil)
	if len(f.Hunter) != 0 { t.Fatalf("absent hunter must not filter: %+v", f.Hunter) }
}

// ?sender=a,b is the target-list picker's exact multi-id selection (#223);
// a single comma-less value keeps the existing leading-prefix behaviour.
// A trailing comma is what makes a ONE-id picker selection distinguishable
// from a typed prefix — the web viewer reuses one field for both.
func TestFilterFromSenderCommaSeparated(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/points?sender=aaaa,%20bbbb", nil)
	f := filterFrom(r, nil)
	if len(f.Senders) != 2 || f.Senders[0] != "aaaa" || f.Senders[1] != "bbbb" {
		t.Fatalf("comma-separated sender not parsed: %+v", f.Senders)
	}
	if f.Sender != "" { t.Fatalf("multi-id selection must not also set the prefix Sender: %q", f.Sender) }

	// Trailing comma → a one-element EXACT set, not a prefix.
	r = httptest.NewRequest(http.MethodGet, "/api/points?sender=aaaa,", nil)
	f = filterFrom(r, nil)
	if len(f.Senders) != 1 || f.Senders[0] != "aaaa" { t.Fatalf("trailing-comma single id not parsed as a set: %+v", f.Senders) }
	if f.Sender != "" { t.Fatalf("trailing-comma form must not set the prefix Sender: %q", f.Sender) }

	// No comma → unchanged prefix search.
	r = httptest.NewRequest(http.MethodGet, "/api/points?sender=aaaa", nil)
	f = filterFrom(r, nil)
	if f.Sender != "aaaa" { t.Fatalf("plain sender must stay a prefix: %q", f.Sender) }
	if len(f.Senders) != 0 { t.Fatalf("plain sender must not set Senders: %+v", f.Senders) }

	// Absent → no filter of either kind.
	r = httptest.NewRequest(http.MethodGet, "/api/points", nil)
	f = filterFrom(r, nil)
	if f.Sender != "" || len(f.Senders) != 0 { t.Fatalf("absent sender must not filter: %q %+v", f.Sender, f.Senders) }
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

// TestPointsHunterOwnFullHistory: a hunter's OWN companion rows must come back
// exact + full history (no 24h window, no 500 cap), while OTHER hunters' old
// rows still get dropped by the guest-style window (#Important-1, spec §4).
func TestPointsHunterOwnFullHistory(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	recent := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	old := time.Now().Add(-72 * time.Hour).UTC().Format(time.RFC3339)
	st.Insert(store.Reception{HunterPubkey: "aaaa", HunterName: "Alice", RxAt: recent, RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.23456, Lon: 4.98765, SenderID: "s1", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "aaaa", HunterName: "Alice", RxAt: old, RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "s1old", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "bbbb", HunterName: "Bob", RxAt: recent, RSSI: -80, Raw: "00", IsDirect: true, Lat: 52.11111, Lon: 5.22222, SenderID: "s2", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "bbbb", HunterName: "Bob", RxAt: old, RSSI: -80, Raw: "00", IsDirect: true, Lat: 52.0, Lon: 5.0, SenderID: "s2old", PacketType: "Response"})
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	out := doPoints(t, st, a)
	pts := out["points"].([]any)
	var sawOldOwn, sawOldOther bool
	for _, p := range pts {
		m := p.(map[string]any)
		if m["sender_id"] == "s1old" {
			sawOldOwn = true
			if m["hunter_pubkey"] != "aaaa" || m["hunter_name"] != "Alice" {
				t.Fatalf("own old row must stay exact: %v", m)
			}
		}
		if m["sender_id"] == "s2old" {
			sawOldOther = true
		}
	}
	if !sawOldOwn {
		t.Fatalf("own old (>24h) row must be included with full history, got points: %v", pts)
	}
	if sawOldOther {
		t.Fatalf("other hunter's old (>24h) row must still be dropped by the 24h window, got points: %v", pts)
	}
}

// TestPointsMemberMultiHunterFilter: a member+ caller passing ?hunter=a,b
// (#196) gets rows from both hunters and nothing else.
func TestPointsMemberMultiHunterFilter(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	st.Insert(store.Reception{HunterPubkey: "cccc", HunterName: "Carol", RxAt: time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339), RSSI: -90, Raw: "00", IsDirect: true, Lat: 53.0, Lon: 6.0, SenderID: "s4", PacketType: "Response"})
	out := doPointsQ(t, st, Auth{Role: "member", UserID: 1, Username: "m"}, "?hunter=aaaa,bbbb")
	pts := out["points"].([]any)
	if len(pts) != 3 { t.Fatalf("multi-hunter filter should return aaaa+bbbb's 3 rows, got %d", len(pts)) }
	for _, p := range pts {
		hp := p.(map[string]any)["hunter_pubkey"]
		if hp == "cccc" { t.Fatalf("hunter outside the filtered set leaked: %v", hp) }
	}
}

// TestPointsGuestMultiHunterCollapsesToFirst: a guest/sub-member is limited to
// a single hunter filter (#196 decision: multi-select is member+ only); a
// multi-value ?hunter= collapses to just the first token.
func TestPointsGuestMultiHunterCollapsesToFirst(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	single := doPointsQ(t, st, Guest(), "?hunter=h1")
	multi := doPointsQ(t, st, Guest(), "?hunter=h1,h2")
	singlePts := single["points"].([]any)
	multiPts := multi["points"].([]any)
	if len(multiPts) != len(singlePts) {
		t.Fatalf("multi-hunter guest filter should collapse to the first token: got %d rows, want %d (== ?hunter=h1)", len(multiPts), len(singlePts))
	}
	for _, p := range multiPts {
		if p.(map[string]any)["hunter_pubkey"] != "h1" { t.Fatalf("collapsed filter should only return h1 rows: %v", p) }
	}
}

// TestHeatmapMemberMultiHunterFilter: member+ heatmap respects a
// comma-separated hunter list the same way /api/points does (#196).
func TestHeatmapMemberMultiHunterFilter(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	st.Insert(store.Reception{HunterPubkey: "cccc", HunterName: "Carol", RxAt: time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339), RSSI: -90, Raw: "00", IsDirect: true, Lat: 53.0, Lon: 6.0, SenderID: "s4", PacketType: "Response"})
	out := doHeatmap(t, st, Auth{Role: "member", UserID: 1, Username: "m"}, "?z=5&hunter=aaaa,bbbb")
	if got := heatmapTotal(t, out); got != 3 {
		t.Fatalf("multi-hunter heatmap should count aaaa+bbbb's 3 rows, got %d", got)
	}
}

func doHeatmap(t *testing.T, st *store.Store, a Auth, query string) map[string]any {
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	r := httptest.NewRequest("GET", "/api/heatmap"+query, nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func heatmapTotal(t *testing.T, g map[string]any) int {
	feats := g["features"].([]any)
	total := 0
	for _, f := range feats {
		total += int(f.(map[string]any)["properties"].(map[string]any)["count"].(float64))
	}
	return total
}

func TestHeatmapGuestResFloor(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	// request a very high zoom as guest -> server must floor it
	r := httptest.NewRequest("GET", "/api/heatmap?z=18", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Guest()))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var g map[string]any
	json.Unmarshal(w.Body.Bytes(), &g)
	feats := g["features"].([]any)
	if len(feats) == 0 {
		t.Fatal("expected some hex features")
	}
	// cell id encodes "res:q:r"; res must be <= ResForZoom(12)
	first := feats[0].(map[string]any)["properties"].(map[string]any)["cell"].(string)
	res := first[:strings.Index(first, ":")]
	if res != "12" {
		t.Fatalf("guest heatmap res = %s, want capped to 12", res)
	}
	// Compare against member (full res) to prove guest is coarser or equal.
	rm := httptest.NewRequest("GET", "/api/heatmap?z=18", nil)
	rm = rm.WithContext(context.WithValue(rm.Context(), authCtxKey, Auth{Role: "member"}))
	wm := httptest.NewRecorder()
	mux.ServeHTTP(wm, rm)
	// (assert member response is 200 and non-empty; exact res comparison depends on geo.ResForZoom)
	if wm.Code != 200 {
		t.Fatalf("member heatmap failed: %d", wm.Code)
	}
	var gm map[string]any
	json.Unmarshal(wm.Body.Bytes(), &gm)
	mfeats := gm["features"].([]any)
	mfirst := mfeats[0].(map[string]any)["properties"].(map[string]any)["cell"].(string)
	mres := mfirst[:strings.Index(mfirst, ":")]
	if mres != "18" {
		t.Fatalf("member heatmap res = %s, want full 18", mres)
	}
}

// TestHeatmapGuestWindowDrop: guest heatmap must drop rows older than the 24h
// window even at low zoom (no res floor triggered).
func TestHeatmapGuestWindowDrop(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doHeatmap(t, st, Guest(), "?z=5")
	if got := heatmapTotal(t, out); got != 2 {
		t.Fatalf("guest heatmap should drop the >24h row, got total count %d, want 2", got)
	}
}

// TestHeatmapMemberFullNoWindow: member/admin heatmap is unchanged -- full
// resolution, no window, all rows counted (including the old one).
func TestHeatmapMemberFullNoWindow(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doHeatmap(t, st, Auth{Role: "member", UserID: 1, Username: "m"}, "?z=5")
	if got := heatmapTotal(t, out); got != 3 {
		t.Fatalf("member heatmap should see all 3 rows, got total count %d", got)
	}
}

// TestHeatmapHunterOwnFilterFullRes: a hunter filtering on their OWN companion
// pubkey gets full resolution (their own data, no degradation).
func TestHeatmapHunterOwnFilterFullRes(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	out := doHeatmap(t, st, a, "?z=18&hunter=aaaa")
	feats := out["features"].([]any)
	if len(feats) == 0 {
		t.Fatal("expected some hex features")
	}
	first := feats[0].(map[string]any)["properties"].(map[string]any)["cell"].(string)
	res := first[:strings.Index(first, ":")]
	if res != "18" {
		t.Fatalf("hunter own-filter heatmap res = %s, want full 18", res)
	}
}

// TestHeatmapGuestRawPubkeyNotTargeted: a guest passing a real, raw pubkey via
// ?hunter= must NOT get a heatmap scoped to just that hunter's rows -- that
// would deanonymize/target them. The response must match the unfiltered guest
// heatmap (same total count, more than one hunter still visible).
func TestHeatmapGuestRawPubkeyNotTargeted(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	baseline := doHeatmap(t, st, Guest(), "")
	out := doHeatmap(t, st, Guest(), "?hunter=bbbb")
	if got, want := heatmapTotal(t, out), heatmapTotal(t, baseline); got != want {
		t.Fatalf("raw pubkey must not narrow the guest heatmap: got total %d, want %d (unfiltered)", got, want)
	}
	seen := map[string]bool{}
	for _, feat := range out["features"].([]any) {
		props := feat.(map[string]any)["properties"].(map[string]any)
		if hs, ok := props["hunters"].([]any); ok {
			for _, h := range hs { seen[h.(string)] = true }
		}
	}
	if len(seen) < 2 {
		t.Fatalf("raw pubkey must not target a single hunter, got hunters: %v", seen)
	}
}

// TestHeatmapGuestNamesPseudonymised: a guest's heatmap must never expose real
// hunter names in per-cell Props.Hunters -- only "Hunter N" pseudonyms.
func TestHeatmapGuestNamesPseudonymised(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doHeatmap(t, st, Guest(), "")
	for _, feat := range out["features"].([]any) {
		props := feat.(map[string]any)["properties"].(map[string]any)
		hs, ok := props["hunters"].([]any)
		if !ok { continue }
		for _, h := range hs {
			name := h.(string)
			if name == "Alice" || name == "Bob" {
				t.Fatalf("guest heatmap leaked a real hunter name: %v", name)
			}
			if len(name) < 6 || name[:6] != "Hunter" {
				t.Fatalf("guest heatmap hunter name not pseudonymised: %v", name)
			}
		}
	}
}

// TestHeatmapHunterOwnPubkeyFullRes: a hunter filtering by their OWN companion
// pubkey gets full resolution (not capped) and their own real name is left
// intact in the per-cell hunter list.
func TestHeatmapHunterOwnPubkeyFullRes(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	out := doHeatmap(t, st, a, "?z=18&hunter=aaaa")
	feats := out["features"].([]any)
	if len(feats) == 0 {
		t.Fatal("expected some hex features")
	}
	first := feats[0].(map[string]any)["properties"].(map[string]any)["cell"].(string)
	res := first[:strings.Index(first, ":")]
	if res != "18" {
		t.Fatalf("own-pubkey heatmap res = %s, want full 18 (not capped)", res)
	}
	sawAlice := false
	for _, feat := range feats {
		props := feat.(map[string]any)["properties"].(map[string]any)
		hs, ok := props["hunters"].([]any)
		if !ok { continue }
		for _, h := range hs {
			if h.(string) == "Alice" { sawAlice = true }
		}
	}
	if !sawAlice {
		t.Fatal("own-companion heatmap must show the real hunter name in the cell list")
	}
}

// TestHeatmapPseudonymTokenResolves: a guest filtering by a pseudonym token
// (h1) must resolve to the ordinal-1 real hunter's rows (non-empty heatmap),
// not silently return empty because the token was never resolved.
func TestHeatmapPseudonymTokenResolves(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	out := doHeatmap(t, st, Guest(), "?hunter=h1")
	if got := heatmapTotal(t, out); got == 0 {
		t.Fatal("pseudonym-token hunter filter returned an empty heatmap, want resolved to the ordinal-1 hunter's rows")
	}
}

func TestHuntersGuestPseudonymised(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	r := httptest.NewRequest("GET", "/api/hunters", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Guest()))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	for _, h := range out["hunters"].([]any) {
		m := h.(map[string]any)
		if m["hunter_pubkey"].(string)[0] != 'h' {
			t.Fatalf("guest hunter pubkey should be pseudonym: %v", m)
		}
	}
}

// TestHuntersHunterOwnReal: a hunter caller sees their own companion's entry
// real (pubkey+name) while every other hunter's entry stays pseudonymised.
func TestHuntersHunterOwnReal(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	r := httptest.NewRequest("GET", "/api/hunters", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	sawOwnReal, sawOtherPseudonym := false, false
	for _, h := range out["hunters"].([]any) {
		m := h.(map[string]any)
		if m["hunter_pubkey"] == "aaaa" {
			if m["hunter_name"] != "Alice" { t.Fatalf("own hunter entry must stay real: %v", m) }
			sawOwnReal = true
		} else {
			if m["hunter_pubkey"].(string)[0] != 'h' { t.Fatalf("other hunter entry must be pseudonymised: %v", m) }
			sawOtherPseudonym = true
		}
	}
	if !sawOwnReal || !sawOtherPseudonym {
		t.Fatalf("expected both an own-real and an other-pseudonymised entry, got out=%v", out)
	}
}

// TestHuntersHunterMultipleCompanionsReal: a hunter with 2 companions must see
// BOTH real on /api/hunters, and a third hunter still pseudonymised
// (#Important-2, spec §5.1/§5.3).
func TestHuntersHunterMultipleCompanionsReal(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	recent := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	st.Insert(store.Reception{HunterPubkey: "aaaa", HunterName: "Alice", RxAt: recent, RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "s1", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "bbbb", HunterName: "Bob", RxAt: recent, RSSI: -80, Raw: "00", IsDirect: true, Lat: 52.0, Lon: 5.0, SenderID: "s2", PacketType: "Response"})
	st.Insert(store.Reception{HunterPubkey: "cccc", HunterName: "Carol", RxAt: recent, RSSI: -75, Raw: "00", IsDirect: true, Lat: 53.0, Lon: 6.0, SenderID: "s3", PacketType: "Response"})
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa", "bbbb"}}
	r := httptest.NewRequest("GET", "/api/hunters", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	sawAliceReal, sawBobReal, sawCarolPseudonym := false, false, false
	for _, h := range out["hunters"].([]any) {
		m := h.(map[string]any)
		switch m["hunter_pubkey"] {
		case "aaaa":
			if m["hunter_name"] != "Alice" { t.Fatalf("companion aaaa must stay real: %v", m) }
			sawAliceReal = true
		case "bbbb":
			if m["hunter_name"] != "Bob" { t.Fatalf("companion bbbb must stay real: %v", m) }
			sawBobReal = true
		default:
			if m["hunter_pubkey"].(string)[0] != 'h' { t.Fatalf("third hunter must be pseudonymised: %v", m) }
			sawCarolPseudonym = true
		}
	}
	if !sawAliceReal || !sawBobReal || !sawCarolPseudonym {
		t.Fatalf("expected both own companions real and the third pseudonymised, got out=%v", out)
	}
}

// TestHuntersMemberReal: member/admin callers get the unchanged, fully real list.
func TestHuntersMemberReal(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	r := httptest.NewRequest("GET", "/api/hunters", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Auth{Role: "member", UserID: 1, Username: "m"}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	seen := map[string]bool{}
	for _, h := range out["hunters"].([]any) {
		m := h.(map[string]any)
		seen[m["hunter_pubkey"].(string)] = true
	}
	if !seen["aaaa"] || !seen["bbbb"] {
		t.Fatalf("member must see real hunter pubkeys, got %v", seen)
	}
}

func TestObserverPointsBlockedForGuest(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	r := httptest.NewRequest("GET", "/api/observer-points?src=advert", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Guest()))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("observer-points must be 403 for guest, got %d", w.Code)
	}
}

// TestObserverPointsBlockedForHunter: a hunter (sub-member) caller must also
// be blocked, not just guest.
func TestObserverPointsBlockedForHunter(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	a := Auth{Role: "hunter", UserID: 1, Username: "alice", Companions: []string{"aaaa"}}
	r := httptest.NewRequest("GET", "/api/observer-points?src=advert", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("observer-points must be 403 for hunter, got %d", w.Code)
	}
}

// TestObserverPointsMemberOK: member/admin behavior is unchanged -- 200 with
// the (feature-disabled, cs==nil in this test) empty points body.
func TestObserverPointsMemberOK(t *testing.T) {
	st := seedPointsStore(t)
	defer st.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, st, nil, nil, nil)
	r := httptest.NewRequest("GET", "/api/observer-points?src=advert", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Auth{Role: "member", UserID: 1, Username: "m"}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("observer-points must be 200 for member, got %d", w.Code)
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
