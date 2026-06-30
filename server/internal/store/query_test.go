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
