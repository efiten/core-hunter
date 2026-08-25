package store

import (
	"testing"
	"time"
)

// The Amsterdam flood of 2026-08-24, as it was actually stored: one message
// heard four times with a growing path, plus a second message from the same
// flood heard once. Real frames, so the ids these produce are the ids the
// backfill will write over the live store.
const (
	msgA4  = "0822480000040426a364fc64fd478be84632b802c7498e0db5334d2910e2"
	msgA5  = "0822480000050426a36431fc64fd478be84632b802c7498e0db5334d2910e2"
	msgA6  = "0822480000060426a3641c57fc64fd478be84632b802c7498e0db5334d2910e2"
	msgA6b = "0822480000060426a3643124fc64fd478be84632b802c7498e0db5334d2910e2"
	msgB8  = "0886c0000008150c287e99644c9a5107765f7144c2bbc36cc7e8f19af9b8"
)

func floodStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	// Note the sender fields: empty, exactly as the live rows are. A 1-byte
	// path hash is refused by the classifier, so this traffic has no sender at
	// all -- which is what makes message_id the only handle it has.
	for _, r := range []struct {
		raw  string
		hops int
		rssi int
	}{
		{msgA4, 4, -106}, {msgA5, 5, -112}, {msgA6, 6, -104}, {msgA6b, 6, -100},
		{msgB8, 8, -92},
	} {
		if err := st.Insert(Reception{
			HunterPubkey: "aaaa", RxAt: now, Raw: r.raw, Hops: r.hops, RSSI: r.rssi,
			PacketType: "TextMessage", Lat: 52.3645, Lon: 4.8331,
		}); err != nil {
			t.Fatal(err)
		}
	}
	return st
}

func ids(t *testing.T, st *Store, f Filter) []int {
	t.Helper()
	f.Limit = 100
	pts, _, err := st.QueryPoints(f)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]int, 0, len(pts))
	for _, p := range pts {
		out = append(out, p.Hops)
	}
	return out
}

func TestMessageFilterGroupsCopiesOfOneTransmission(t *testing.T) {
	// The gap this closes: with no sender there was nothing to filter on, so a
	// hunter watching a flood of 2,707 receptions could not narrow to it at
	// all. Four of these five rows are one message; the fifth is not.
	st := floodStore(t)
	defer st.Close()

	all := ids(t, st, Filter{})
	if len(all) != 5 {
		t.Fatalf("fixture should hold 5 receptions, got %d", len(all))
	}

	var msgID string
	pts, _, _ := st.QueryPoints(Filter{Limit: 100})
	_ = pts
	// Read the id back out of the store rather than recomputing it here: the
	// point is that Insert wrote the same value the filter looks for.
	row := st.db.QueryRow(`SELECT message_id FROM hunter_receptions WHERE hops = 4`)
	if err := row.Scan(&msgID); err != nil {
		t.Fatal(err)
	}
	if msgID == "" {
		t.Fatal("Insert stored no message_id")
	}

	got := ids(t, st, Filter{Message: msgID})
	if len(got) != 4 {
		t.Fatalf("the four copies of one message: got %d rows %v", len(got), got)
	}
	for _, h := range got {
		if h == 8 {
			t.Fatalf("the other message leaked into the group: %v", got)
		}
	}
}

func TestOriginOnlyKeepsTheShortestPathCopies(t *testing.T) {
	// Within a message the sender's own prefix is common to every copy, and a
	// relay appends. So the fewest hashes is the fewest real forwards -- the
	// copies that ran 19 dB stronger in the median over the real hunt.
	st := floodStore(t)
	defer st.Close()
	got := ids(t, st, Filter{OriginOnly: true})
	if len(got) != 1 || got[0] != 4 {
		t.Fatalf("only the 4-hash copy should survive, got %v", got)
	}
}

func TestOriginOnlyDropsAMessageHeardOnce(t *testing.T) {
	// A single copy is trivially its own minimum, so calling it a
	// shortest-path copy claims evidence that does not exist. In the real hunt
	// three such singletons at -34 dBm sat 9.4 km from every other clue and
	// would have dragged an estimate with them.
	st := floodStore(t)
	defer st.Close()
	for _, h := range ids(t, st, Filter{OriginOnly: true}) {
		if h == 8 {
			t.Fatal("a message heard once must not count as an origin copy")
		}
	}
}

func TestOriginOnlyTakesTheMinimumWithinTheDriveBeingAskedAbout(t *testing.T) {
	// The minimum has to be over the set in question, not over the whole table:
	// the shortest path seen countrywide is not the shortest path seen tonight.
	// Here a time filter excludes the 4-hash copy, so the 5-hash one becomes the
	// shortest thing this drive heard and has to be promoted.
	st := floodStore(t)
	defer st.Close()
	if _, err := st.db.Exec(`UPDATE hunter_receptions SET rx_at = '2020-01-01T00:00:00Z' WHERE hops = 4`); err != nil {
		t.Fatal(err)
	}
	got := ids(t, st, Filter{OriginOnly: true, From: "2021-01-01T00:00:00Z"})
	if len(got) != 1 || got[0] != 5 {
		t.Fatalf("with the 4-hash copy out of the window, the 5-hash one is the minimum, got %v", got)
	}
}

func TestOriginOnlyDoesNotInheritTheHopFilter(t *testing.T) {
	// A hop filter is a display choice, not a description of the drive.
	// Inheriting it into the comparison would leave one copy per message, make
	// every message look heard-once, and empty the result -- so the rule would
	// silently stop working exactly when someone combined the two controls.
	st := floodStore(t)
	defer st.Close()
	six := 6
	got := ids(t, st, Filter{OriginOnly: true, Hops: &six})
	// Nothing survives here, and that is the CORRECT answer: no 6-hash copy is
	// the shortest of its message. What matters is why it is empty -- the
	// comparison ran over all four copies and rejected these two, rather than
	// being starved of anything to compare.
	if len(got) != 0 {
		t.Fatalf("a 6-hash copy is not the shortest of its message, got %v", got)
	}
	four := 4
	if got := ids(t, st, Filter{OriginOnly: true, Hops: &four}); len(got) != 1 {
		t.Fatalf("the 4-hash copy IS the shortest and must survive the same combination, got %v", got)
	}
}

func TestBackfillFillsRowsStoredBeforeTheColumnExisted(t *testing.T) {
	// Someone reviewing last night's hunt is the whole audience for this, so a
	// filter that only works on traffic captured after the deploy is no use.
	st := floodStore(t)
	defer st.Close()
	if _, err := st.db.Exec(`UPDATE hunter_receptions SET message_id = NULL`); err != nil {
		t.Fatal(err)
	}
	if err := st.backfillMessageIDs(); err != nil {
		t.Fatal(err)
	}
	var blank int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM hunter_receptions WHERE message_id IS NULL`).Scan(&blank); err != nil {
		t.Fatal(err)
	}
	if blank != 0 {
		t.Fatalf("%d rows left without a message_id", blank)
	}
	if got := ids(t, st, Filter{OriginOnly: true}); len(got) != 1 || got[0] != 4 {
		t.Fatalf("after backfill the filter must work the same, got %v", got)
	}
}

func TestUnreadableFrameGetsAnEmptyIDRatherThanNull(t *testing.T) {
	// Otherwise every restart re-examines the same rows forever. Empty also
	// keeps it out of OriginOnly, which is right: a frame we cannot read has
	// no message to be a copy of.
	st := floodStore(t)
	defer st.Close()
	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.Insert(Reception{HunterPubkey: "aaaa", RxAt: now, Raw: "zz", Hops: 0, PacketType: "Raw"}); err != nil {
		t.Fatal(err)
	}
	var id *string
	if err := st.db.QueryRow(`SELECT message_id FROM hunter_receptions WHERE raw = 'zz'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if id == nil || *id != "" {
		t.Fatalf("want an empty id, got %v", id)
	}
}

func TestNoSenderKeepsWhatNothingCouldBeAttributedTo(t *testing.T) {
	// The coarse handle. A flood using 1-byte path hashes leaves no sender at
	// all, and on the real hunt that was 2,756 of 3,078 receptions -- the exact
	// set the hunter wanted, with no way to ask for it.
	st := floodStore(t)
	defer st.Close()
	now := time.Now().UTC().Format(time.RFC3339)
	// One row that DOES have a sender, so the filter has something to exclude.
	if err := st.Insert(Reception{HunterPubkey: "aaaa", RxAt: now, Raw: msgB8, Hops: 1,
		SenderID: "aabb", SenderKind: "relay", PacketType: "TextMessage", Lat: 52.36, Lon: 4.83}); err != nil {
		t.Fatal(err)
	}
	f := Filter{NoSender: true, Limit: 100}
	pts, _, err := st.QueryPoints(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) != 5 {
		t.Fatalf("the five unattributable rows: got %d", len(pts))
	}
	for _, p := range pts {
		if p.SenderID != "" {
			t.Fatalf("a row with a sender leaked in: %q", p.SenderID)
		}
	}
	// And it composes with the origin rule, which is the combination that
	// actually answers "where is this flood coming from".
	got := ids(t, st, Filter{NoSender: true, OriginOnly: true})
	if len(got) != 1 || got[0] != 4 {
		t.Fatalf("unattributable origin copies: got %v", got)
	}
}
