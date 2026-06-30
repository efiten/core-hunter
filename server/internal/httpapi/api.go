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
