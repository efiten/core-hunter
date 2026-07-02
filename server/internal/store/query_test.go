package store

import "testing"

func seed(t *testing.T) *Store {
	st, err := Open(":memory:")
	if err != nil { t.Fatalf("open: %v", err) }
	rows := []Reception{
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:00:00Z", RSSI: -70, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "aa", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T11:00:00Z", RSSI: -80, Raw: "00", IsDirect: true, Lat: 51.0, Lon: 4.0, SenderID: "bb", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h2", HunterName: "B", RxAt: "2026-06-30T10:30:00Z", RSSI: -60, Raw: "00", IsDirect: true, Lat: 52.0, Lon: 5.0, SenderID: "aa", SenderKind: "direct_hash", PacketType: "Response"},
		{HunterPubkey: "h1", HunterName: "A", RxAt: "2026-06-30T10:10:00Z", RSSI: -50, Raw: "00", IsDirect: false, Lat: 51.0, Lon: 4.0, SenderID: "cc", PacketType: "Response"}, // relayed → excluded
	}
	for _, r := range rows { if err := st.Insert(r); err != nil { t.Fatalf("insert: %v", err) } }
	return st
}

func TestQueryPointsZeroHopAndFilters(t *testing.T) {
	st := seed(t); defer st.Close()
	// bbox covering both hunters, sender prefix 'a', hunter h1
	got, _, err := st.QueryPoints(Filter{HasBBox: true, MinLat: 50, MinLon: 3, MaxLat: 53, MaxLon: 6, Hunter: "h1", Sender: "a", Limit: 10})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 1 || got[0].SenderID != "aa" || got[0].HunterPubkey != "h1" {
		t.Fatalf("hunter+sender filter wrong: %+v", got)
	}
	// relayed row never returned
	all, _, _ := st.QueryPoints(Filter{Limit: 100})
	for _, p := range all { if p.SenderID == "cc" { t.Fatal("relayed row leaked") } }
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
	// 3 zero-hop rows total; Limit 2 → truncated. Limit 3 (==total) → not truncated.
	got, trunc, _ := st.QueryPoints(Filter{Limit: 2})
	if len(got) != 2 || !trunc { t.Fatalf("expected 2 rows + truncated, got %d trunc=%v", len(got), trunc) }
	got, trunc, _ = st.QueryPoints(Filter{Limit: 3})
	if len(got) != 3 || trunc { t.Fatalf("expected 3 rows + not truncated, got %d trunc=%v", len(got), trunc) }
}

func TestQueryPointsOffsetPaging(t *testing.T) {
	st := seed(t); defer st.Close()
	// 3 zero-hop rows, newest first: bb(11:00), aa@h2(10:30), aa@h1(10:00).
	p1, trunc1, err := st.QueryPoints(Filter{Limit: 2})
	if err != nil { t.Fatalf("page1: %v", err) }
	p2, trunc2, err := st.QueryPoints(Filter{Limit: 2, Offset: 2})
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
	p3, trunc3, _ := st.QueryPoints(Filter{Limit: 2, Offset: 10})
	if len(p3) != 0 || trunc3 { t.Fatalf("past-end page: got %d trunc=%v", len(p3), trunc3) }
}

func TestHunters(t *testing.T) {
	st := seed(t); defer st.Close()
	hs, _ := st.Hunters("", "", nil)
	m := map[string]int{}; for _, h := range hs { m[h.Pubkey] = h.Count }
	if m["h1"] != 2 || m["h2"] != 1 { t.Fatalf("hunters counts (zero-hop only) wrong: %+v", hs) }
}

func TestHuntersIgnore(t *testing.T) {
	st := seed(t); defer st.Close()
	// ignore 'aa' → h1 keeps bb (1), h2 loses its only sender (aa) → drops out.
	hs, _ := st.Hunters("", "", []string{"aa"})
	m := map[string]int{}; for _, h := range hs { m[h.Pubkey] = h.Count }
	if m["h1"] != 1 || m["h2"] != 0 { t.Fatalf("hunters ignore wrong: %+v", hs) }
}
