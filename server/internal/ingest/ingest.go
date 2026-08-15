package ingest

import (
	"log"

	"github.com/efiten/core-hunter/server/internal/store"
)

type Store interface {
	Insert(store.Reception) error
	InsertRaw(topic, payload, receivedAt, errMsg string) error
}

func Handle(s Store, topic string, body []byte, now func() string) error {
	ts := now()
	r, err := store.ParsePayload(topic, body, ts)
	if err != nil {
		return deadLetter(s, topic, body, ts, "parse: "+err.Error())
	}
	if r.Raw == "" || r.RxAt == "" {
		return deadLetter(s, topic, body, ts, "missing raw or rx_at")
	}
	if ierr := s.Insert(r); ierr != nil {
		if rerr := s.InsertRaw(topic, string(body), ts, "insert: "+ierr.Error()); rerr != nil {
			return rerr
		}
		return ierr
	}
	return nil
}

// deadLetter parks an unusable message in raw_messages AND says so in the log.
// The table has no reader anywhere in the repo and Handle returns nil once the
// row is stored, so without this a publisher sending unusable payloads at
// packet rate is completely silent: every message is acked, nothing is
// plotted, and no log line points at the cause (#346).
func deadLetter(s Store, topic string, body []byte, ts, reason string) error {
	log.Printf("ingest: dead-lettered %s: %s", topic, reason)
	return s.InsertRaw(topic, string(body), ts, reason)
}
