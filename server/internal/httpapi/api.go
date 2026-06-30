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

func filterFrom(r *http.Request, baseIgnore []string) store.Filter {
	q := r.URL.Query()
	f := store.Filter{From: q.Get("from"), To: q.Get("to"), Hunter: q.Get("hunter"), Sender: q.Get("sender")}
	if minLat, minLon, maxLat, maxLon, ok := ParseBBox(q.Get("bbox")); ok {
		f.HasBBox, f.MinLat, f.MinLon, f.MaxLat, f.MaxLon = true, minLat, minLon, maxLat, maxLon
	}
	// Server-configured ignore list is always enforced, merged with any per-request ?ignore=.
	f.Ignore = append([]string(nil), baseIgnore...)
	if ig := strings.TrimSpace(q.Get("ignore")); ig != "" {
		f.Ignore = append(f.Ignore, strings.Split(ig, ",")...)
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil { f.Limit = n }
	return f
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

const heatmapCap = 50000

func RegisterRoutes(mux *http.ServeMux, s *store.Store, ignore []string) {
	mux.HandleFunc("/api/points", func(w http.ResponseWriter, r *http.Request) {
		pts, trunc, err := s.QueryPoints(filterFrom(r, ignore))
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, map[string]any{"points": pts, "truncated": trunc})
	})
	mux.HandleFunc("/api/heatmap", func(w http.ResponseWriter, r *http.Request) {
		z, _ := strconv.Atoi(r.URL.Query().Get("z"))
		f := filterFrom(r, ignore)
		f.Limit = heatmapCap
		pts, trunc, err := s.QueryPoints(f)
		if err != nil { http.Error(w, err.Error(), 500); return }
		fc := query.Heatmap(pts, geo.ResForZoom(z))
		fc.Truncated = trunc
		writeJSON(w, fc)
	})
	mux.HandleFunc("/api/hunters", func(w http.ResponseWriter, r *http.Request) {
		f := filterFrom(r, ignore)
		hs, err := s.Hunters(f.From, f.To, f.Ignore)
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, map[string]any{"hunters": hs})
	})
}
