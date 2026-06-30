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
	ring := fc.Features[0].Geometry.Coordinates
	if len(ring) != 1 || len(ring[0]) < 7 {
		t.Fatalf("polygon ring malformed")
	}
	// GeoJSON order is [lon,lat]: the cell holds points near lon=4, lat=51,
	// so the first coordinate (lon) must be near 4 and the second (lat) near 51.
	lon, lat := ring[0][0][0], ring[0][0][1]
	if lon < 3 || lon > 5 || lat < 50 || lat > 52 {
		t.Fatalf("coords not GeoJSON [lon,lat]: got [%v,%v]", lon, lat)
	}
}
