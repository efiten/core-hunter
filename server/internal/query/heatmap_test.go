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
