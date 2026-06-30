package query

import (
	"sort"

	"github.com/efiten/core-hunter/server/internal/geo"
	"github.com/efiten/core-hunter/server/internal/store"
)

type FeatureCollection struct {
	Type      string    `json:"type"`
	Features  []Feature `json:"features"`
	Truncated bool      `json:"truncated,omitempty"`
}
type Feature struct {
	Type       string  `json:"type"`
	Geometry   Polygon `json:"geometry"`
	Properties Props   `json:"properties"`
}
type Polygon struct {
	Type        string         `json:"type"`
	Coordinates [][][2]float64 `json:"coordinates"`
}
type Props struct {
	Cell     string   `json:"cell"`
	Count    int      `json:"count"`
	BestRSSI *int     `json:"best_rssi"`
	Hunters  []string `json:"hunters"`
}

// Heatmap bins points into hex cells and returns GeoJSON.
// BestRSSI is the maximum (strongest, least-negative dBm) RSSI seen in the cell.
// Hunters is a sorted, deduplicated list of non-empty HunterName values.
// Output order is deterministic (cells sorted by id).
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
		if a == nil {
			a = &agg{hunters: map[string]bool{}}
			cells[id] = a
		}
		a.count++
		if p.HunterName != "" {
			a.hunters[p.HunterName] = true
		}
		if p.RSSI != nil && (a.best == nil || *p.RSSI > *a.best) {
			v := *p.RSSI
			a.best = &v
		}
	}
	ids := make([]string, 0, len(cells))
	for id := range cells {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	fc := FeatureCollection{Type: "FeatureCollection", Features: []Feature{}}
	for _, id := range ids {
		a := cells[id]
		ring := geo.HexBoundary(id)
		if ring == nil {
			continue
		}
		coords := make([][2]float64, len(ring))
		copy(coords, ring) // HexBoundary already returns GeoJSON-order [lon,lat]
		hs := make([]string, 0, len(a.hunters))
		for h := range a.hunters {
			hs = append(hs, h)
		}
		sort.Strings(hs)
		fc.Features = append(fc.Features, Feature{
			Type:       "Feature",
			Geometry:   Polygon{Type: "Polygon", Coordinates: [][][2]float64{coords}},
			Properties: Props{Cell: id, Count: a.count, BestRSSI: a.best, Hunters: hs},
		})
	}
	return fc
}
