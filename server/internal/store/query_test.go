package store

import "testing"

func seed(t *testing.T) *Store {
	st, err := Open(":memory:")
	if err != nil { t.Fatalf("open: %v", err) }
	rows := []Reception{
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:00:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "aa", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T11:00:00Z", RSSI: -80, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "bb", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h2", HunterName: "B", RxAt: "2026-06-30T10:30:00Z", RSSI: -60, Raw: "00", IsDirect: true, Lat: 52.0, Lon: 5.0, SenderID: "aa", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:10:00Z", RSSI: -50, Raw: "00", IsDirect: false, Hops: 2, Lat: 51.0, Lon: 4.0, SenderID: "cc", PacketType: "Response"}, // relayed (last-hop measurement)
	}
	for _, r := range rows { if err := st.Insert(r); err != nil { t.Fatalf("insert: %v", err) } }
	return st
}

// hops0 returns the direct-only filter value (hops = 0) for tests.
func hops0() *int { z := 0; return &z }

func TestQueryPointsZeroHopAndFilters(t *testing.T) {
	st := seed(t); defer st.Close()
	// bbox covering both hunters, sender prefix 'a', hunter h1
	got, _, err := st.QueryPoints(Filter{HasBBox: true, MinLat: 50, MinLon: 3, MaxLat: 53, MaxLon: 6, Hunter: []string{"h1"}, Sender: "a", Limit: 10})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 1 || got[0].SenderID != "aa" || got[0].HunterPubkey != "h1" {
		t.Fatalf("hunter+sender filter wrong: %+v", got)
	}
	// no hops filter → relayed rows are returned too (#142: is_direct is not a
	// query condition; direct-only is an explicit hops=0 filter)
	all, _, _ := st.QueryPoints(Filter{Limit: 100})
	seen := false
	for _, p := range all { if p.SenderID == "cc" { seen = true; if p.Hops != 2 { t.Fatalf("hops not exposed: %+v", p) } } }
	if !seen { t.Fatal("relayed row missing without hops filter") }
	// hops=0 → relayed row excluded
	direct, _, _ := st.QueryPoints(Filter{Hops: hops0(), Limit: 100})
	if len(direct) != 3 { t.Fatalf("hops=0 filter wrong: %+v", direct) }
	for _, p := range direct { if p.SenderID == "cc" { t.Fatal("relayed row leaked through hops=0") } }
}

// TestQueryPointsMultipleHunters: Hunter with 2+ pubkeys matches an IN-set
// (#196); an empty Hunter slice still means no filter.
func TestQueryPointsMultipleHunters(t *testing.T) {
	st := seed(t); defer st.Close()
	got, _, err := st.QueryPoints(Filter{Hunter: []string{"h1", "h2"}, Limit: 100})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 4 { t.Fatalf("multi-hunter filter wrong: got %d, want 4 (all h1+h2 rows)", len(got)) }
	for _, p := range got {
		if p.HunterPubkey != "h1" && p.HunterPubkey != "h2" { t.Fatalf("unexpected hunter leaked: %+v", p) }
	}
	one, _, _ := st.QueryPoints(Filter{Hunter: []string{"h2"}, Limit: 100})
	if len(one) != 1 || one[0].HunterPubkey != "h2" { t.Fatalf("single-element slice must behave like exact match: %+v", one) }
}

// TestQueryPointsMultipleSenders: Senders with 2+ ids matches an exact IN-set
// (#223), mirroring Hunter's #196 shape. Distinct from Sender, which stays a
// single leading-prefix LIKE — the target-list picker selects whole ids, so
// prefix semantics would over-match (picking 'aa' must not also match 'aab').
func TestQueryPointsMultipleSenders(t *testing.T) {
	st := seed(t); defer st.Close()
	got, _, err := st.QueryPoints(Filter{Senders: []string{"aa", "bb"}, Limit: 100})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 3 { t.Fatalf("multi-sender filter wrong: got %d, want 3 (2x aa + 1x bb)", len(got)) }
	for _, p := range got {
		if p.SenderID != "aa" && p.SenderID != "bb" { t.Fatalf("unexpected sender leaked: %+v", p) }
	}
	one, _, _ := st.QueryPoints(Filter{Senders: []string{"cc"}, Limit: 100})
	if len(one) != 1 || one[0].SenderID != "cc" { t.Fatalf("single-element slice must behave like exact match: %+v", one) }
}

// Senders is exact, not prefix: a picked id must never pull in longer ids that
// merely start with it. Sender (the free-text field) keeps prefix behaviour.
func TestQueryPointsSendersIsExactNotPrefix(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil { t.Fatalf("open: %v", err) }
	defer st.Close()
	for _, r := range []Reception{
		{HunterPubkey: "h1", RxAt: "2026-06-30T10:00:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51, Lon: 4, SenderID: "aa", PacketType: "Advert"},
		{HunterPubkey: "h1", RxAt: "2026-06-30T10:01:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51, Lon: 4, SenderID: "aabb", PacketType: "Advert"},
	} {
		if err := st.Insert(r); err != nil { t.Fatalf("insert: %v", err) }
	}
	exact, _, _ := st.QueryPoints(Filter{Senders: []string{"aa"}, Limit: 100})
	if len(exact) != 1 || exact[0].SenderID != "aa" { t.Fatalf("Senders must be exact: %+v", exact) }
	prefix, _, _ := st.QueryPoints(Filter{Sender: "aa", Limit: 100})
	if len(prefix) != 2 { t.Fatalf("Sender must stay a prefix match: %+v", prefix) }
}

// Case-insensitive, matching how Sender and the ignore-list already behave.
func TestQueryPointsSendersCaseInsensitive(t *testing.T) {
	st := seed(t); defer st.Close()
	got, _, _ := st.QueryPoints(Filter{Senders: []string{"AA"}, Limit: 100})
	if len(got) != 2 { t.Fatalf("Senders must be case-insensitive: got %d, want 2", len(got)) }
}

func TestQueryPointsPacketTypeFilter(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil { t.Fatalf("open: %v", err) }
	defer st.Close()
	rows := []Reception{
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:00:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51, Lon: 4, SenderID: "aa", PacketType: "Advert"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:01:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51, Lon: 4, SenderID: "bb", PacketType: "GroupText"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:02:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51, Lon: 4, SenderID: "cc", PacketType: "Trace"},
	}
	for _, r := range rows { if err := st.Insert(r); err != nil { t.Fatalf("insert: %v", err) } }
	got, _, err := st.QueryPoints(Filter{Types: []string{"Advert", "GroupText"}, Limit: 10})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 2 { t.Fatalf("types filter wrong: %+v", got) }
	for _, p := range got { if p.PacketType == "Trace" { t.Fatal("filtered type leaked") } }
	// empty Types → all rows
	all, _, _ := st.QueryPoints(Filter{Limit: 10})
	if len(all) != 3 { t.Fatalf("no-types filter wrong: %+v", all) }
}

func TestQueryPointsReturnsSenderRole(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil { t.Fatalf("open: %v", err) }
	defer st.Close()
	if err := st.Insert(Reception{
		HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T12:00:00Z", RSSI: -90, Raw: "00",
		IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "7b0e24700e0c0d3e",
		SenderKind: "discover_pubkey", SenderRole: "Repeater", PacketType: "Control",
	}); err != nil { t.Fatalf("insert: %v", err) }
	got, _, err := st.QueryPoints(Filter{Limit: 10})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 1 || got[0].SenderRole != "Repeater" || got[0].SenderID != "7b0e24700e0c0d3e" {
		t.Fatalf("sender_role not returned: %+v", got)
	}
}

func TestQueryPointsTimeAndIgnore(t *testing.T) {
	st := seed(t); defer st.Close()
	got, _, _ := st.QueryPoints(Filter{From: "2026-06-30T10:15:00Z", To: "2026-06-30T11:30:00Z", Ignore: []string{"aa"}, Limit: 100})
	// in window: 11:00(bb,h1). 10:30(aa,h2) ignored. → only bb
	if len(got) != 1 || got[0].SenderID != "bb" { t.Fatalf("time+ignore wrong: %+v", got) }
}

func TestQueryPointsTruncation(t *testing.T) {
	st := seed(t); defer st.Close()
	// 3 zero-hop rows; Limit 2 → truncated. Limit 3 (==total) → not truncated.
	got, trunc, _ := st.QueryPoints(Filter{Hops: hops0(), Limit: 2})
	if len(got) != 2 || !trunc { t.Fatalf("expected 2 rows + truncated, got %d trunc=%v", len(got), trunc) }
	got, trunc, _ = st.QueryPoints(Filter{Hops: hops0(), Limit: 3})
	if len(got) != 3 || trunc { t.Fatalf("expected 3 rows + not truncated, got %d trunc=%v", len(got), trunc) }
}

func TestQueryPointsOffsetPaging(t *testing.T) {
	st := seed(t); defer st.Close()
	// 3 zero-hop rows, newest first: bb(11:00), aa@h2(10:30), aa@h1(10:00).
	p1, trunc1, err := st.QueryPoints(Filter{Hops: hops0(), Limit: 2})
	if err != nil { t.Fatalf("page1: %v", err) }
	p2, trunc2, err := st.QueryPoints(Filter{Hops: hops0(), Limit: 2, Offset: 2})
	if err != nil { t.Fatalf("page2: %v", err) }
	if len(p1) != 2 || !trunc1 { t.Fatalf("page1: want 2 rows truncated, got %d trunc=%v", len(p1), trunc1) }
	if len(p2) != 1 || trunc2 { t.Fatalf("page2: want 1 row not truncated, got %d trunc=%v", len(p2), trunc2) }
	if p1[0].RxAt != "2026-06-30T11:00:00Z" || p2[0].RxAt != "2026-06-30T10:00:00Z" {
		t.Fatalf("pages out of order: p1[0]=%s p2[0]=%s", p1[0].RxAt, p2[0].RxAt)
	}
	// no overlap between pages
	for _, a := range p1 {
		if a.RxAt == p2[0].RxAt && a.HunterPubkey == p2[0].HunterPubkey {
			t.Fatalf("pages overlap on %s", a.RxAt)
		}
	}
	// offset past the end → empty, not truncated
	p3, trunc3, _ := st.QueryPoints(Filter{Hops: hops0(), Limit: 2, Offset: 10})
	if len(p3) != 0 || trunc3 { t.Fatalf("past-end page: got %d trunc=%v", len(p3), trunc3) }
}

func TestHunters(t *testing.T) {
	st := seed(t); defer st.Close()
	// counts include relayed rows (#142): h1 has 2 zero-hop + 1 relayed.
	hs, _ := st.Hunters("", "", nil)
	m := map[string]int{}; for _, h := range hs { m[h.Pubkey] = h.Count }
	if m["h1"] != 3 || m["h2"] != 1 { t.Fatalf("hunters counts wrong: %+v", hs) }
}

func TestHuntersIgnore(t *testing.T) {
	st := seed(t); defer st.Close()
	// ignore 'aa' → h1 keeps bb + cc (2), h2 loses its only sender (aa) → drops out.
	hs, _ := st.Hunters("", "", []string{"aa"})
	m := map[string]int{}; for _, h := range hs { m[h.Pubkey] = h.Count }
	if m["h1"] != 2 || m["h2"] != 0 { t.Fatalf("hunters ignore wrong: %+v", hs) }
}

func TestHunterOrdinals(t *testing.T) {
	st := seed(t) // h1 first at 10:00, h2 first at 10:30 (see existing seed rows)
	defer st.Close()
	ord, err := st.HunterOrdinals()
	if err != nil { t.Fatalf("ordinals: %v", err) }
	if ord["h1"] != 1 || ord["h2"] != 2 { t.Fatalf("ordinals by first appearance wrong: %+v", ord) }
}
