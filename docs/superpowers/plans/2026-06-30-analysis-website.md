# core-hunter — Analysis website (iteration 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public web map at `map.on8ar.eu` showing all hunters' zero-hop receptions as points + a hex-heatmap (toggle), filterable by hunter, sender, and timeframe — served by a read API added to the Go ingestor.

**Architecture:** Extend the existing ingestor with read-only HTTP endpoints over the same SQLite (WAL → safe concurrent reads). Port CoreScope's pure hex-binning. A plain static frontend (no build step) reuses the mobile app's RSSI tiers, drawing points (circle markers) + hex polygons from the API. nginx serves the static site and proxies `/api` to the ingestor.

**Tech Stack:** Go 1.24 + `modernc.org/sqlite`; static HTML/ESM + Leaflet 1.9.4 (CDN); nginx + certbot.

## Global Constraints

- All read endpoints gate on `is_direct = 1` (zero-hop only) and exclude the `ignore` list. No DB writes, no purge, no schema change.
- Filters: `hunter` = exact `hunter_pubkey`; `sender` = `sender_id` case-insensitive prefix; `from`/`to` = `rx_at` RFC3339 UTC range; `bbox` = `minLat,minLon,maxLat,maxLon`; `ignore` = comma-separated `sender_id`s. DB is UTC; the frontend converts local (CEST, UTC+2) date+hour pickers to UTC.
- Colour by RSSI tier (hot=strong=close), reusing the mobile `rssiTier` bands + `--ch-sig-*` tokens.
- Same-origin (nginx serves static + `/api` under `map.on8ar.eu`) → no CORS needed.
- Deploy port: ingestor read API published on host **`:3003`** (must be open in the Oracle Cloud security list — verify, like `:3002`).
- Tests required for logic (`go test` for backend; frontend is build-free DOM glue, verified live). Branch `feat/analysis-website` → PR. Commit body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Subagents verify `git branch --show-current` = `feat/analysis-website` before committing.

---

## Task 1: port hex-binning into `server/internal/geo`

**Files:**
- Create: `server/internal/geo/hexgrid.go`, `server/internal/geo/hexgrid_test.go`

**Interfaces:**
- Produces (package `geo`, **exported**): `HexCellAt(lat, lon float64, res int) string` (→ `"res:q:r"`), `HexBoundary(cellID string) [][2]float64` (ring of `[lat,lon]`, closed), `ResForZoom(z int) int`.

- [ ] **Step 1: Copy CoreScope's pure hex grid**

Run:
```bash
cp ../CoreScope/cmd/server/hexgrid.go server/internal/geo/hexgrid.go
cp ../CoreScope/cmd/server/hexgrid_test.go server/internal/geo/hexgrid_test.go
```
Edit both files: change the `package server` line to `package geo`. In `hexgrid.go`, **export** the three functions used by other packages by capitalising their names and all internal call sites: `hexCellAt`→`HexCellAt`, `hexBoundary`→`HexBoundary` (leave `hexMercator`, `hexInvMercator`, `hexRound`, `hexSizeForRes`, `parseHexCell` as-is — they're only used internally). Update `hexgrid_test.go`'s calls to the renamed functions.

- [ ] **Step 2: Add `ResForZoom` (from CoreScope rx_coverage `zoomToHexRes`)**

Append to `server/internal/geo/hexgrid.go`:
```go
// ResForZoom maps a Leaflet zoom level to a hex resolution, clamped to [3,18].
func ResForZoom(z int) int {
	if z < 3 {
		return 3
	}
	if z > 18 {
		return 18
	}
	return z
}
```

- [ ] **Step 3: Add a test for `ResForZoom` + run**

Append to `hexgrid_test.go`:
```go
func TestResForZoom(t *testing.T) {
	if ResForZoom(1) != 3 || ResForZoom(14) != 14 || ResForZoom(99) != 18 {
		t.Fatalf("ResForZoom clamp wrong: %d %d %d", ResForZoom(1), ResForZoom(14), ResForZoom(99))
	}
}
```
Run: `cd server && go test ./internal/geo/`
Expected: PASS (CoreScope's boundary/stability tests + ResForZoom).

- [ ] **Step 4: Commit**
```bash
git add server/internal/geo/
git commit -m "feat(server): port pure hex-binning into internal/geo"
```

---

## Task 2: store read queries — points + hunters

**Files:**
- Create: `server/internal/store/query.go`, `server/internal/store/query_test.go`

**Interfaces:**
- Consumes: `*Store` (`s.db`), the existing `hunter_receptions` schema.
- Produces:
  - `type Filter struct { MinLat, MinLon, MaxLat, MaxLon float64; HasBBox bool; From, To, Hunter, Sender string; Ignore []string; Limit int }`
  - `type Point struct { Lat, Lon float64; RSSI *int; SNR *float64; SenderID, SenderLabel, SenderKind, HunterPubkey, HunterName, ChannelName, PacketType, RxAt string }`
  - `(*Store) QueryPoints(f Filter) ([]Point, error)` — zero-hop rows matching the filter, newest first, capped at `f.Limit` (default 5000 if ≤0).
  - `type Hunter struct { Pubkey, Name string; Count int }`; `(*Store) Hunters(from, to string) ([]Hunter, error)`.

- [ ] **Step 1: Write the failing test**

`server/internal/store/query_test.go`:
```go
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
	got, err := st.QueryPoints(Filter{HasBBox: true, MinLat: 50, MinLon: 3, MaxLat: 53, MaxLon: 6, Hunter: "h1", Sender: "a", Limit: 10})
	if err != nil { t.Fatalf("query: %v", err) }
	if len(got) != 1 || got[0].SenderID != "aa" || got[0].HunterPubkey != "h1" {
		t.Fatalf("hunter+sender filter wrong: %+v", got)
	}
	// relayed row never returned
	all, _ := st.QueryPoints(Filter{Limit: 100})
	for _, p := range all { if p.SenderID == "cc" { t.Fatal("relayed row leaked") } }
}

func TestQueryPointsTimeAndIgnore(t *testing.T) {
	st := seed(t); defer st.Close()
	got, _ := st.QueryPoints(Filter{From: "2026-06-30T10:15:00Z", To: "2026-06-30T11:30:00Z", Ignore: []string{"aa"}, Limit: 100})
	// in window: 11:00(bb,h1). 10:30(aa,h2) ignored. → only bb
	if len(got) != 1 || got[0].SenderID != "bb" { t.Fatalf("time+ignore wrong: %+v", got) }
}

func TestHunters(t *testing.T) {
	st := seed(t); defer st.Close()
	hs, _ := st.Hunters("", "")
	m := map[string]int{}; for _, h := range hs { m[h.Pubkey] = h.Count }
	if m["h1"] != 2 || m["h2"] != 1 { t.Fatalf("hunters counts (zero-hop only) wrong: %+v", hs) }
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd server && go test ./internal/store/ -run 'QueryPoints|Hunters'`
Expected: FAIL (undefined `QueryPoints`/`Filter`/`Hunters`).

- [ ] **Step 3: Implement `query.go`**

`server/internal/store/query.go`:
```go
package store

import (
	"database/sql"
	"strings"
)

type Filter struct {
	MinLat, MinLon, MaxLat, MaxLon float64
	HasBBox                        bool
	From, To, Hunter, Sender       string
	Ignore                         []string
	Limit                          int
}

type Point struct {
	Lat          float64  `json:"lat"`
	Lon          float64  `json:"lon"`
	RSSI         *int     `json:"rssi"`
	SNR          *float64 `json:"snr"`
	SenderID     string   `json:"sender_id"`
	SenderLabel  string   `json:"sender_label"`
	SenderKind   string   `json:"sender_kind"`
	HunterPubkey string   `json:"hunter_pubkey"`
	HunterName   string   `json:"hunter_name"`
	ChannelName  string   `json:"channel_name"`
	PacketType   string   `json:"packet_type"`
	RxAt         string   `json:"rx_at"`
}

func (f Filter) where() (string, []any) {
	conds := []string{"is_direct=1"}
	var args []any
	if f.HasBBox {
		conds = append(conds, "lat BETWEEN ? AND ?", "lon BETWEEN ? AND ?")
		args = append(args, f.MinLat, f.MaxLat, f.MinLon, f.MaxLon)
	}
	if f.From != "" {
		conds = append(conds, "rx_at >= ?"); args = append(args, f.From)
	}
	if f.To != "" {
		conds = append(conds, "rx_at <= ?"); args = append(args, f.To)
	}
	if f.Hunter != "" {
		conds = append(conds, "hunter_pubkey = ?"); args = append(args, f.Hunter)
	}
	if f.Sender != "" {
		conds = append(conds, "sender_id IS NOT NULL AND lower(sender_id) LIKE ?"); args = append(args, strings.ToLower(f.Sender)+"%")
	}
	if len(f.Ignore) > 0 {
		ph := make([]string, len(f.Ignore))
		for i, s := range f.Ignore { ph[i] = "?"; args = append(args, strings.ToLower(s)) }
		conds = append(conds, "(sender_id IS NULL OR lower(sender_id) NOT IN ("+strings.Join(ph, ",")+"))")
	}
	return strings.Join(conds, " AND "), args
}

func (s *Store) QueryPoints(f Filter) ([]Point, error) {
	if f.Limit <= 0 { f.Limit = 5000 }
	w, args := f.where()
	args = append(args, f.Limit)
	rows, err := s.db.Query(`SELECT lat,lon,rssi,snr,sender_id,sender_label,sender_kind,hunter_pubkey,hunter_name,channel_name,packet_type,rx_at
		FROM hunter_receptions WHERE `+w+` ORDER BY rx_at DESC LIMIT ?`, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Point
	for rows.Next() {
		var p Point
		var rssi sql.NullInt64
		var snr sql.NullFloat64
		var sid, slabel, skind, cn sql.NullString
		if err := rows.Scan(&p.Lat, &p.Lon, &rssi, &snr, &sid, &slabel, &skind, &p.HunterPubkey, &p.HunterName, &cn, &p.PacketType, &p.RxAt); err != nil {
			return nil, err
		}
		if rssi.Valid { v := int(rssi.Int64); p.RSSI = &v }
		if snr.Valid { p.SNR = &snr.Float64 }
		p.SenderID, p.SenderLabel, p.SenderKind, p.ChannelName = sid.String, slabel.String, skind.String, cn.String
		out = append(out, p)
	}
	return out, rows.Err()
}

type Hunter struct {
	Pubkey string `json:"hunter_pubkey"`
	Name   string `json:"hunter_name"`
	Count  int    `json:"count"`
}

func (s *Store) Hunters(from, to string) ([]Hunter, error) {
	conds := []string{"is_direct=1"}
	var args []any
	if from != "" { conds = append(conds, "rx_at >= ?"); args = append(args, from) }
	if to != "" { conds = append(conds, "rx_at <= ?"); args = append(args, to) }
	rows, err := s.db.Query(`SELECT hunter_pubkey, max(hunter_name), count(*) FROM hunter_receptions WHERE `+strings.Join(conds, " AND ")+` GROUP BY hunter_pubkey ORDER BY 3 DESC`, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Hunter
	for rows.Next() {
		var h Hunter
		if err := rows.Scan(&h.Pubkey, &h.Name, &h.Count); err != nil { return nil, err }
		out = append(out, h)
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd server && go test ./internal/store/`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**
```bash
git add server/internal/store/query.go server/internal/store/query_test.go
git commit -m "feat(server): store read queries — QueryPoints + Hunters (zero-hop, filtered)"
```

---

## Task 3: heatmap aggregation (points → GeoJSON hex)

**Files:**
- Create: `server/internal/query/heatmap.go`, `server/internal/query/heatmap_test.go`

**Interfaces:**
- Consumes: `store.Point` (Task 2), `geo.HexCellAt`/`geo.HexBoundary` (Task 1).
- Produces: `Heatmap(points []store.Point, res int) FeatureCollection` where `FeatureCollection`/`Feature`/`Polygon`/`Props` marshal to GeoJSON; per cell `Props{ Cell string; Count int; BestRSSI *int; Hunters []string }`.

- [ ] **Step 1: Write the failing test**

`server/internal/query/heatmap_test.go`:
```go
package query

import (
	"testing"
	"github.com/efiten/core-hunter/server/internal/store"
)

func TestHeatmapBestRSSIPerCell(t *testing.T) {
	r1, r2 := -80, -60
	pts := []store.Point{
		{Lat: 51.0, Lon: 4.0, RSSI: &r1, HunterName: "A"},
		{Lat: 51.0, Lon: 4.0, RSSI: &r2, HunterName: "B"}, // same cell, stronger
	}
	fc := Heatmap(pts, 12)
	if fc.Type != "FeatureCollection" || len(fc.Features) != 1 {
		t.Fatalf("want 1 feature, got %+v", fc)
	}
	p := fc.Features[0].Properties
	if p.Count != 2 || p.BestRSSI == nil || *p.BestRSSI != -60 {
		t.Fatalf("best-rssi/count wrong: %+v", p)
	}
	if len(p.Hunters) != 2 {
		t.Fatalf("want 2 hunters, got %v", p.Hunters)
	}
	if len(fc.Features[0].Geometry.Coordinates) != 1 || len(fc.Features[0].Geometry.Coordinates[0]) < 7 {
		t.Fatalf("polygon ring malformed")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd server && go test ./internal/query/`
Expected: FAIL (no `Heatmap`).

- [ ] **Step 3: Implement `heatmap.go`**

`server/internal/query/heatmap.go`:
```go
package query

import (
	"sort"

	"github.com/efiten/core-hunter/server/internal/geo"
	"github.com/efiten/core-hunter/server/internal/store"
)

type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}
type Feature struct {
	Type       string  `json:"type"`
	Geometry   Polygon `json:"geometry"`
	Properties Props   `json:"properties"`
}
type Polygon struct {
	Type        string          `json:"type"`
	Coordinates [][][2]float64  `json:"coordinates"`
}
type Props struct {
	Cell     string   `json:"cell"`
	Count    int      `json:"count"`
	BestRSSI *int     `json:"best_rssi"`
	Hunters  []string `json:"hunters"`
}

// Heatmap bins zero-hop points into hex cells (best RSSI per cell = strongest, i.e. max dBm).
func Heatmap(points []store.Point, res int) FeatureCollection {
	type agg struct {
		count   int
		best    *int
		hunters map[string]bool
	}
	cells := map[string]*agg{}
	for _, p := range points {
		id := geo.HexCellAt(p.Lat, p.Lon, res)
		a := cells[id]
		if a == nil { a = &agg{hunters: map[string]bool{}}; cells[id] = a }
		a.count++
		if p.HunterName != "" { a.hunters[p.HunterName] = true }
		if p.RSSI != nil && (a.best == nil || *p.RSSI > *a.best) { v := *p.RSSI; a.best = &v }
	}
	fc := FeatureCollection{Type: "FeatureCollection", Features: []Feature{}}
	ids := make([]string, 0, len(cells))
	for id := range cells { ids = append(ids, id) }
	sort.Strings(ids) // deterministic order
	for _, id := range ids {
		a := cells[id]
		ring := geo.HexBoundary(id)
		if ring == nil { continue }
		coords := make([][2]float64, len(ring))
		for i, ll := range ring { coords[i] = [2]float64{ll[1], ll[0]} } // [lat,lon] → GeoJSON [lon,lat]
		hs := make([]string, 0, len(a.hunters))
		for h := range a.hunters { hs = append(hs, h) }
		sort.Strings(hs)
		fc.Features = append(fc.Features, Feature{
			Type:       "Feature",
			Geometry:   Polygon{Type: "Polygon", Coordinates: [][][2]float64{coords}},
			Properties: Props{Cell: id, Count: a.count, BestRSSI: a.best, Hunters: hs},
		})
	}
	return fc
}
```

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd server && go test ./internal/query/ && go build ./... && go vet ./...`
Expected: PASS, clean.
```bash
git add server/internal/query/
git commit -m "feat(server): heatmap aggregation — best-RSSI hex GeoJSON"
```

---

## Task 4: HTTP read endpoints in the ingestor

**Files:**
- Create: `server/internal/httpapi/api.go`, `server/internal/httpapi/api_test.go`
- Modify: `server/cmd/ingestor/main.go` (register routes)

**Interfaces:**
- Consumes: `*store.Store` (`QueryPoints`, `Hunters`), `query.Heatmap`, `geo.ResForZoom`.
- Produces: `RegisterRoutes(mux *http.ServeMux, s *store.Store)` registering `GET /api/points`, `GET /api/heatmap`, `GET /api/hunters`; and exported `ParseBBox(string) (minLat, minLon, maxLat, maxLon float64, ok bool)`.

- [ ] **Step 1: Write the failing test (param parsing)**

`server/internal/httpapi/api_test.go`:
```go
package httpapi

import "testing"

func TestParseBBox(t *testing.T) {
	a, b, c, d, ok := ParseBBox("51.0,4.0,52.0,5.0")
	if !ok || a != 51.0 || b != 4.0 || c != 52.0 || d != 5.0 { t.Fatalf("good bbox parsed wrong: %v %v %v %v %v", a, b, c, d, ok) }
	if _, _, _, _, ok := ParseBBox("nope"); ok { t.Fatal("bad bbox accepted") }
	if _, _, _, _, ok := ParseBBox("1,2,3"); ok { t.Fatal("short bbox accepted") }
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd server && go test ./internal/httpapi/`
Expected: FAIL (no `ParseBBox`).

- [ ] **Step 3: Implement `api.go`**

`server/internal/httpapi/api.go`:
```go
package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/efiten/core-hunter/server/internal/geo"
	"github.com/efiten/core-hunter/server/internal/query"
	"github.com/efiten/core-hunter/server/internal/store"
)

func ParseBBox(s string) (minLat, minLon, maxLat, maxLon float64, ok bool) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 { return }
	v := make([]float64, 4)
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil { return 0, 0, 0, 0, false }
		v[i] = f
	}
	return v[0], v[1], v[2], v[3], true
}

func filterFrom(r *http.Request) store.Filter {
	q := r.URL.Query()
	f := store.Filter{From: q.Get("from"), To: q.Get("to"), Hunter: q.Get("hunter"), Sender: q.Get("sender")}
	if minLat, minLon, maxLat, maxLon, ok := ParseBBox(q.Get("bbox")); ok {
		f.HasBBox, f.MinLat, f.MinLon, f.MaxLat, f.MaxLon = true, minLat, minLon, maxLat, maxLon
	}
	if ig := strings.TrimSpace(q.Get("ignore")); ig != "" {
		f.Ignore = strings.Split(ig, ",")
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil { f.Limit = n }
	return f
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func RegisterRoutes(mux *http.ServeMux, s *store.Store) {
	mux.HandleFunc("/api/points", func(w http.ResponseWriter, r *http.Request) {
		pts, err := s.QueryPoints(filterFrom(r))
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, map[string]any{"points": pts, "truncated": len(pts) >= effLimit(r)})
	})
	mux.HandleFunc("/api/heatmap", func(w http.ResponseWriter, r *http.Request) {
		z, _ := strconv.Atoi(r.URL.Query().Get("z"))
		pts, err := s.QueryPoints(filterFrom(r))
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, query.Heatmap(pts, geo.ResForZoom(z)))
	})
	mux.HandleFunc("/api/hunters", func(w http.ResponseWriter, r *http.Request) {
		hs, err := s.Hunters(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, map[string]any{"hunters": hs})
	})
}

func effLimit(r *http.Request) int {
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 { return n }
	return 5000
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd server && go test ./internal/httpapi/`
Expected: PASS.

- [ ] **Step 5: Register routes in main.go**

In `server/cmd/ingestor/main.go`, the HTTP server currently uses `http.HandleFunc("/healthz", …)` on the default mux. Switch to an explicit mux and register the API. Replace the `http.HandleFunc("/healthz", …)` + `http.ListenAndServe(cfg.HTTPAddr, nil)` with:
```go
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if client == nil || !client.IsConnected() {
			w.WriteHeader(http.StatusServiceUnavailable); _, _ = w.Write([]byte("mqtt disconnected")); return
		}
		w.WriteHeader(http.StatusOK); _, _ = w.Write([]byte("ok"))
	})
	httpapi.RegisterRoutes(mux, st)
	go func() {
		if err := http.ListenAndServe(cfg.HTTPAddr, mux); err != nil {
			log.Printf("http server stopped: %v", err)
		}
	}()
```
Add `"github.com/efiten/core-hunter/server/internal/httpapi"` to imports. (Keep the existing graceful-shutdown signal wait after this.)

- [ ] **Step 6: Build + commit**

Run: `cd server && go build ./... && go vet ./... && go test ./...`
Expected: build OK, all PASS.
```bash
git add server/internal/httpapi/ server/cmd/ingestor/main.go
git commit -m "feat(server): /api/points, /api/heatmap, /api/hunters read endpoints"
```

---

## Task 5: static frontend scaffold (`web/`)

**Files:**
- Create: `web/index.html`, `web/style.css`, `web/signal.js`, `web/config.js`

**Interfaces:**
- Produces: the static page shell + `rssiTier`/`tierColorVar`/`fillOpacity` (copied from the mobile app) + `API_BASE` config consumed by Tasks 6-7. No build step — plain ESM + Leaflet CDN.

- [ ] **Step 1: Copy the RSSI tier helper + tokens**

`cp app/src/signal.js web/signal.js` (it is framework-free ESM; used as-is).
`web/config.js`:
```js
// Same-origin in production (nginx serves /api). Empty base = relative.
export const API_BASE = ''
```

- [ ] **Step 2: `web/index.html`**
```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>core-hunter — analysis</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header id="bar">
    <select id="f-hunter"><option value="">All hunters</option></select>
    <input id="f-sender" type="text" placeholder="sender id (prefix)" />
    <label>from <input id="f-from" type="datetime-local" /></label>
    <label>to <input id="f-to" type="datetime-local" /></label>
    <button id="layer-toggle">points</button>
    <span id="status"></span>
  </header>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="map.js"></script>
</body>
</html>
```

- [ ] **Step 3: `web/style.css` (RSSI tokens + layout)**
```css
:root { --ch-bg:#0b0e14; --ch-text:#e6edf3; --ch-surface:rgba(18,23,33,0.92);
  --ch-sig-hot:#ff453a; --ch-sig-warm:#ff9f0a; --ch-sig-mid:#ffd60a; --ch-sig-cool:#40c8ff; --ch-sig-cold:#5e7bff; --ch-sig-none:#5b6675; }
* { box-sizing: border-box; }
html,body { margin:0; height:100%; background:var(--ch-bg); color:var(--ch-text); font-family:system-ui,sans-serif; }
#bar { position:fixed; top:0; left:0; right:0; z-index:600; display:flex; gap:8px; align-items:center; flex-wrap:wrap;
  padding:8px 12px; background:var(--ch-surface); backdrop-filter:blur(8px); font-size:14px; }
#bar select, #bar input, #bar button { background:#11161f; color:var(--ch-text); border:1px solid #2a3340; border-radius:6px; padding:5px 8px; font:inherit; }
#bar button { cursor:pointer; }
#status { color:#9aa; margin-left:auto; }
#map { position:fixed; inset:0; top:48px; }
```

- [ ] **Step 4: Commit**
```bash
git add web/index.html web/style.css web/signal.js web/config.js
git commit -m "feat(web): analysis site scaffold (static, Leaflet, RSSI tokens)"
```

---

## Task 6: map — points + hex layers + toggle (`web/map.js`)

**Files:**
- Create: `web/map.js`

**Interfaces:**
- Consumes: `rssiTier`/`tierColorVar`/`fillOpacity` from `signal.js`, `API_BASE` from `config.js`, the filter inputs from `index.html`, and `window.currentFilters()` (Task 7).
- Produces: `refresh()` (debounced fetch + redraw of the active layer), and the `#layer-toggle` cycling points→hex→both.

- [ ] **Step 1: Implement `web/map.js`** (DOM/Leaflet glue — verified by loading the page)
```js
import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { API_BASE } from './config.js'

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
const map = L.map('map', { zoomControl: true }).setView([51, 4], 12)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
const pointLayer = L.layerGroup().addTo(map)
const hexLayer = L.layerGroup().addTo(map)
let mode = 'points'

const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

function qs() {
  const b = map.getBounds()
  const p = new URLSearchParams({ bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), z: String(map.getZoom()) })
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  return p.toString()
}

async function drawPoints() {
  pointLayer.clearLayers()
  const r = await fetch(`${API_BASE}/api/points?${qs()}`); const d = await r.json()
  for (const pt of d.points || []) {
    const tier = rssiTier(pt.rssi)
    L.circleMarker([pt.lat, pt.lon], { radius: 5, color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(pt.sender_label || pt.sender_id || '—')}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || pt.packet_type)}<br>${esc(pt.rx_at)}`)
      .addTo(pointLayer)
  }
  document.getElementById('status').textContent = `${(d.points||[]).length} points${d.truncated ? ' (capped)' : ''}`
}

async function drawHex() {
  hexLayer.clearLayers()
  const r = await fetch(`${API_BASE}/api/heatmap?${qs()}`); const fc = await r.json()
  for (const f of fc.features || []) {
    const ring = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon])
    const tier = rssiTier(f.properties.best_rssi)
    L.polygon(ring, { color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindTooltip(`best RSSI ${esc(f.properties.best_rssi)} · ${f.properties.count} pts · ${(f.properties.hunters||[]).length} hunters`)
      .addTo(hexLayer)
  }
}

let t = null
export function refresh() {
  clearTimeout(t)
  t = setTimeout(() => {
    if (mode === 'points' || mode === 'both') drawPoints(); else pointLayer.clearLayers()
    if (mode === 'hex' || mode === 'both') drawHex(); else hexLayer.clearLayers()
  }, 250)
}

document.getElementById('layer-toggle').addEventListener('click', (e) => {
  mode = mode === 'points' ? 'hex' : mode === 'hex' ? 'both' : 'points'
  e.target.textContent = mode
  refresh()
})
map.on('moveend zoomend', refresh)
window.__refresh = refresh
refresh()
```

- [ ] **Step 2: Commit**
```bash
git add web/map.js
git commit -m "feat(web): points + hex layers with points/hex/both toggle"
```

---

## Task 7: filters wiring (`web/filters.js`)

**Files:**
- Create: `web/filters.js`
- Modify: `web/index.html` (load `filters.js` before `map.js`)

**Interfaces:**
- Produces: `window.currentFilters()` → `{ hunter, sender, from, to }` (from/to converted local→UTC RFC3339); populates the hunter dropdown from `/api/hunters`; calls `window.__refresh()` on any filter change.

- [ ] **Step 1: Implement `web/filters.js`**
```js
import { API_BASE } from './config.js'

const localToUTC = (v) => (v ? new Date(v).toISOString() : '') // datetime-local is local time → ISO UTC

window.currentFilters = () => ({
  hunter: document.getElementById('f-hunter').value,
  sender: document.getElementById('f-sender').value.trim(),
  from: localToUTC(document.getElementById('f-from').value),
  to: localToUTC(document.getElementById('f-to').value),
})

async function loadHunters() {
  try {
    const r = await fetch(`${API_BASE}/api/hunters`); const d = await r.json()
    const sel = document.getElementById('f-hunter')
    for (const h of d.hunters || []) {
      const o = document.createElement('option')
      o.value = h.hunter_pubkey
      o.textContent = `${h.hunter_name || h.hunter_pubkey.slice(0, 8)} (${h.count})`
      sel.appendChild(o)
    }
  } catch (_) {}
}

for (const id of ['f-hunter', 'f-sender', 'f-from', 'f-to']) {
  const el = document.getElementById(id)
  el.addEventListener('change', () => window.__refresh && window.__refresh())
  if (id === 'f-sender') el.addEventListener('input', () => window.__refresh && window.__refresh())
}
loadHunters()
```

- [ ] **Step 2: Load `filters.js` before `map.js` in `index.html`**

Change the module script tags at the bottom of `web/index.html` to:
```html
  <script type="module" src="filters.js"></script>
  <script type="module" src="map.js"></script>
```

- [ ] **Step 3: Build sanity + commit**

There is no build; sanity-check by serving locally: `cd web && python -m http.server 8080` and load `http://localhost:8080/` (it will fail API calls without the backend — that's expected; verify no JS console errors in module loading and the map renders).
```bash
git add web/filters.js web/index.html
git commit -m "feat(web): filter bar — hunter/sender/timeframe wired to refresh"
```

---

## Task 8: deploy `map.on8ar.eu`

**Files:** none (operational).

- [ ] **Step 1: Publish the ingestor API on :3003 + verify the port is OCI-open**

On meshcore-oracle, re-run the ingestor with the API port published (host `:3003` → container `:8090`). First confirm `:3003` is reachable from the nginx box (94.130.105.135) — same OCI-security-list check as `:3002`:
```bash
# from the nginx box:
timeout 4 bash -c "cat </dev/null >/dev/tcp/84.235.164.234/3003" && echo OPEN || echo BLOCKED
```
If BLOCKED, the user must open TCP 3003 in the Oracle Cloud security list before continuing.
On oracle:
```bash
cd ~/core-hunter && git fetch origin && git reset --hard origin/master
docker build -t core-hunter-ingestor server
docker rm -f core-hunter-ingestor
docker run -d --name core-hunter-ingestor --restart unless-stopped -p 3003:8090 \
  -v $HOME/core-hunter-cfg/ingestor-config.json:/app/config.json:ro -v $HOME/core-hunter-data:/app/data core-hunter-ingestor
curl -s localhost:3003/api/hunters   # sanity: JSON
```

- [ ] **Step 2: Deploy the static frontend + nginx vhost on the nginx box**

Copy `web/` to the nginx box (`/var/www/map.on8ar.eu`) and add the vhost `/etc/nginx/sites-available/map.on8ar.eu`:
```nginx
server {
    server_name map.on8ar.eu;
    root /var/www/map.on8ar.eu;
    index index.html;
    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location / { add_header Cache-Control "no-cache"; try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://84.235.164.234:3003;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    listen 80;
}
```
Then: ensure DNS `map.on8ar.eu` → 94.130.105.135 exists; `ln -s` into sites-enabled; `nginx -t && systemctl reload nginx`; `certbot --nginx -d map.on8ar.eu -n --redirect`.

- [ ] **Step 3: Verify end-to-end**

`curl -s https://map.on8ar.eu/api/hunters` → JSON; open `https://map.on8ar.eu` → map loads, points appear for the current bbox, the toggle switches points/hex/both, and the hunter/sender/timeframe filters narrow the set.

---

## Verification (end-to-end)

1. `cd server && go test ./...` → geo / store / query / httpapi suites PASS; `go build ./...` clean.
2. `https://map.on8ar.eu/api/points?bbox=50,3,53,6` returns zero-hop points; `/api/heatmap?...&z=12` returns GeoJSON; `/api/hunters` lists hunters.
3. Site: points + hex toggle works; filter by hunter, by sender prefix, and a from/to window narrows the map; ignored senders excluded when `ignore` is passed.

## Self-review notes (spec coverage)

- Points + hex + toggle → Tasks 3,6. Filters hunter/sender/timeframe → Tasks 2 (store), 4 (params), 7 (UI). Zero-hop + ignore server-side → Task 2. Raw best-RSSI hex → Task 3. Reuse mobile `signal.js` → Task 5. Extend ingestor (read API over WAL SQLite) → Tasks 2-4. map.on8ar.eu public, nginx + :3003 OCI port → Task 8. Hex binning reuse → Task 1. UTC/local timeframe → Task 7 (`localToUTC`). Deferred (normalization, channel filter, auth/user-mgmt) → not in any task, per spec out-of-scope.
