package store

import "testing"

const samplePayload = `{
 "origin_id":"aabb","origin":"hunter-1","timestamp":"2026-06-29T10:00:00Z",
 "type":"PACKET","direction":"rx","raw":"deadbeef","SNR":-3.5,"RSSI":-92,
 "is_direct":true,"hops":0,"sender_key":"a1","sender_keylen":1,"sender_role":"",
 "packet_type":"channel-msg","gps":{"lat":51.0,"lon":4.0,"acc_m":8.0}
}`

func TestParsePayloadMapsAllFields(t *testing.T) {
	r, err := ParsePayload("meshcore/hunter/aabb/packets", []byte(samplePayload), "2026-06-29T10:00:01Z")
	if err != nil {
		t.Fatalf("ParsePayload: %v", err)
	}
	if r.HunterPubkey != "aabb" || r.HunterName != "hunter-1" {
		t.Fatalf("hunter fields wrong: %+v", r)
	}
	if !r.IsDirect || r.Hops != 0 || r.SenderKeylen != 1 || r.SNR != -3.5 || r.RSSI != -92 {
		t.Fatalf("signal/axis fields wrong: %+v", r)
	}
	if r.Raw != "deadbeef" || r.PacketType != "channel-msg" || r.Lat != 51.0 {
		t.Fatalf("payload fields wrong: %+v", r)
	}
	if r.IngestedAt != "2026-06-29T10:00:01Z" || r.MQTTTopic == "" {
		t.Fatalf("ingest meta wrong: %+v", r)
	}
}

func TestInsertRoundTrip(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	r, _ := ParsePayload("t", []byte(samplePayload), "2026-06-29T10:00:01Z")
	if err := st.Insert(r); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	var n int
	if err := st.db.QueryRow(`SELECT count(*) FROM hunter_receptions WHERE is_direct=1`).Scan(&n); err != nil {
		t.Fatalf("query: %v", err)
	}
	if n != 1 {
		t.Fatalf("rows=%d want 1", n)
	}
}

func TestInsertRawRoundTrip(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	if err := st.InsertRaw("t", "body", "now", "oops"); err != nil {
		t.Fatalf("InsertRaw: %v", err)
	}
	var payload, errMsg string
	if err := st.db.QueryRow(`SELECT payload, error FROM raw_messages WHERE topic='t'`).Scan(&payload, &errMsg); err != nil {
		t.Fatalf("query: %v", err)
	}
	if payload != "body" || errMsg != "oops" {
		t.Fatalf("got payload=%q error=%q", payload, errMsg)
	}
}

func TestParsePayloadSenderFields(t *testing.T) {
	body := []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","is_direct":true,"hops":0,
	  "sender_kind":"channel_name","sender_id":"Spammer","sender_label":"Spammer","channel_name":"public",
	  "packet_type":"GroupText","gps":{"lat":1,"lon":2}}`)
	r, err := ParsePayload("t", body, "now")
	if err != nil {
		t.Fatalf("ParsePayload: %v", err)
	}
	if r.SenderKind != "channel_name" || r.SenderID != "Spammer" || r.SenderLabel != "Spammer" || r.ChannelName != "public" {
		t.Fatalf("sender fields: %+v", r)
	}
}

func TestInsertSenderFieldsRoundTrip(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	r, _ := ParsePayload("t", []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","is_direct":true,"hops":0,"sender_kind":"direct_hash","sender_id":"4a","sender_label":"4a","packet_type":"Response","gps":{"lat":1,"lon":2}}`), "now")
	if err := st.Insert(r); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	var kind, id string
	if err := st.db.QueryRow(`SELECT sender_kind, sender_id FROM hunter_receptions ORDER BY id DESC LIMIT 1`).Scan(&kind, &id); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if kind != "direct_hash" || id != "4a" {
		t.Fatalf("got %q %q", kind, id)
	}
}

// #346: an absent or null acc_m must stay distinguishable from a real 0 —
// stored as SQL NULL rather than as the most accurate row in the table.
func TestParsePayloadKeepsUnknownAccuracyDistinctFromZero(t *testing.T) {
	cases := []struct {
		name string
		gps  string
		want *float64
	}{
		{"real value", `{"lat":1,"lon":2,"acc_m":8.5}`, f64(8.5)},
		{"explicit zero", `{"lat":1,"lon":2,"acc_m":0}`, f64(0)},
		{"explicit null", `{"lat":1,"lon":2,"acc_m":null}`, nil},
		{"absent key", `{"lat":1,"lon":2}`, nil},
	}
	for _, c := range cases {
		body := []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","gps":` + c.gps + `}`)
		r, err := ParsePayload("t", body, "now")
		if err != nil {
			t.Fatalf("%s: ParsePayload: %v", c.name, err)
		}
		switch {
		case c.want == nil && r.PosAccM != nil:
			t.Fatalf("%s: want unknown accuracy, got %v", c.name, *r.PosAccM)
		case c.want != nil && r.PosAccM == nil:
			t.Fatalf("%s: want %v, got unknown", c.name, *c.want)
		case c.want != nil && *r.PosAccM != *c.want:
			t.Fatalf("%s: want %v, got %v", c.name, *c.want, *r.PosAccM)
		}
	}
}

func TestInsertStoresUnknownAccuracyAsNULL(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()
	// Both parses are checked: if ParsePayload ever started rejecting a
	// payload without acc_m, an ignored error would leave a zero Reception
	// whose PosAccM is nil anyway, and this test would still pass.
	unknown, err := ParsePayload("t", []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","gps":{"lat":1,"lon":2}}`), "now")
	if err != nil {
		t.Fatalf("ParsePayload (unknown accuracy): %v", err)
	}
	known, err := ParsePayload("t", []byte(`{"origin_id":"bb","timestamp":"t","raw":"00","gps":{"lat":1,"lon":2,"acc_m":12}}`), "now")
	if err != nil {
		t.Fatalf("ParsePayload (known accuracy): %v", err)
	}
	for _, r := range []Reception{unknown, known} {
		if err := st.Insert(r); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}
	var nullRows, zeroRows int
	if err := st.db.QueryRow(`SELECT count(*) FROM hunter_receptions WHERE pos_acc_m IS NULL`).Scan(&nullRows); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if err := st.db.QueryRow(`SELECT count(*) FROM hunter_receptions WHERE pos_acc_m = 0`).Scan(&zeroRows); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if nullRows != 1 || zeroRows != 0 {
		t.Fatalf("null=%d zero=%d, want 1 and 0", nullRows, zeroRows)
	}
}

// A reception without a position is useless to this product — the app itself
// refuses to capture one — so a payload missing lat/lon is a parse failure and
// lands in the dead-letter table, rather than being stored at the null island.
func TestParsePayloadRejectsAMissingPosition(t *testing.T) {
	for _, body := range []string{
		`{"origin_id":"aa","timestamp":"t","raw":"00"}`,
		`{"origin_id":"aa","timestamp":"t","raw":"00","gps":{}}`,
		`{"origin_id":"aa","timestamp":"t","raw":"00","gps":{"lat":1}}`,
		`{"origin_id":"aa","timestamp":"t","raw":"00","gps":{"lon":2}}`,
	} {
		if _, err := ParsePayload("t", []byte(body), "now"); err == nil {
			t.Fatalf("want error for %s", body)
		}
	}
}

func f64(v float64) *float64 { return &v }
