package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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
