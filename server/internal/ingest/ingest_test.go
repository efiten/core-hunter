package ingest

import (
	"errors"
	"strings"
	"testing"

	"github.com/efiten/core-hunter/server/internal/store"
)

type fake struct {
	got    []store.Reception
	raws   []rawRow
	insErr error
}
type rawRow struct{ topic, payload, ts, err string }

func (f *fake) Insert(r store.Reception) error {
	if f.insErr != nil {
		return f.insErr
	}
	f.got = append(f.got, r)
	return nil
}
func (f *fake) InsertRaw(topic, payload, ts, errMsg string) error {
	f.raws = append(f.raws, rawRow{topic, payload, ts, errMsg})
	return nil
}

func TestHandleInsertsParsedReception(t *testing.T) {
	f := &fake{}
	body := []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","hops":2,"is_direct":false,"gps":{"lat":1,"lon":2}}`)
	if err := Handle(f, "meshcore/hunter/aa/packets", body, func() string { return "now" }); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(f.got) != 1 || f.got[0].Hops != 2 || f.got[0].IngestedAt != "now" {
		t.Fatalf("bad reception: %+v", f.got)
	}
}

func TestHandleParseFailure(t *testing.T) {
	f := &fake{}
	body := []byte(`not json`)
	err := Handle(f, "topic/x", body, func() string { return "ts" })
	if err != nil {
		t.Fatalf("Handle should return nil (data safe in raw): %v", err)
	}
	if len(f.got) != 0 {
		t.Fatalf("Insert should not be called on parse failure")
	}
	if len(f.raws) != 1 {
		t.Fatalf("InsertRaw should be called once, got %d", len(f.raws))
	}
	if !strings.HasPrefix(f.raws[0].err, "parse:") {
		t.Fatalf("error should have parse: prefix, got %q", f.raws[0].err)
	}
	if f.raws[0].payload != string(body) {
		t.Fatalf("payload mismatch: got %q want %q", f.raws[0].payload, string(body))
	}
}

func TestHandleEmptyRaw(t *testing.T) {
	f := &fake{}
	// valid JSON but missing "raw" field
	body := []byte(`{"origin_id":"aa","timestamp":"t","hops":0,"is_direct":false,"gps":{"lat":1,"lon":2}}`)
	err := Handle(f, "topic/x", body, func() string { return "ts" })
	if err != nil {
		t.Fatalf("Handle should return nil: %v", err)
	}
	if len(f.got) != 0 {
		t.Fatalf("Insert should not be called")
	}
	if len(f.raws) != 1 || f.raws[0].err != "missing raw or rx_at" {
		t.Fatalf("unexpected raws: %+v", f.raws)
	}
}

func TestHandleInsertFailure(t *testing.T) {
	insErr := errors.New("db full")
	f := &fake{insErr: insErr}
	body := []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","hops":2,"is_direct":false,"gps":{"lat":1,"lon":2}}`)
	err := Handle(f, "topic/x", body, func() string { return "ts" })
	if err != insErr {
		t.Fatalf("Handle should surface insert error, got %v", err)
	}
	if len(f.raws) != 1 {
		t.Fatalf("InsertRaw should be called once, got %d", len(f.raws))
	}
	if !strings.HasPrefix(f.raws[0].err, "insert:") {
		t.Fatalf("error should have insert: prefix, got %q", f.raws[0].err)
	}
}

// #346: a payload with no position is dead-lettered rather than stored at 0,0.
func TestHandleDeadLettersAPayloadWithoutAPosition(t *testing.T) {
	f := &fake{}
	body := []byte(`{"origin_id":"aa","timestamp":"t","raw":"00","hops":0,"is_direct":true}`)
	if err := Handle(f, "meshcore/hunter/aa/packets", body, func() string { return "now" }); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(f.got) != 0 {
		t.Fatalf("Insert should not be called: %+v", f.got)
	}
	if len(f.raws) != 1 || !strings.Contains(f.raws[0].err, "gps") {
		t.Fatalf("want a dead-letter row naming gps, got %+v", f.raws)
	}
}
