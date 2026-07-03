package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveStripsLatLonBelowMember(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"prefix":"aa11","pubkey":"deadbeef","name":"RepeaterX","ambiguous":false,"lat":51.2,"lon":4.9}`))
	}))
	defer upstream.Close()
	h := &ResolveAPI{Upstreams: []string{upstream.URL}, Client: upstream.Client()}

	// guest: name kept, lat/lon stripped
	r := httptest.NewRequest("GET", "/api/resolve?prefix=aa11", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Guest()))
	w := httptest.NewRecorder()
	h.Resolve(w, r)
	var g resolveResult
	json.Unmarshal(w.Body.Bytes(), &g)
	if g.Name != "RepeaterX" || g.Lat != nil || g.Lon != nil {
		t.Fatalf("guest must get name without coords: %+v", g)
	}
	// member: lat/lon present
	rm := httptest.NewRequest("GET", "/api/resolve?prefix=aa11", nil)
	rm = rm.WithContext(context.WithValue(rm.Context(), authCtxKey, Auth{Role: "member"}))
	wm := httptest.NewRecorder()
	h.Resolve(wm, rm)
	var m resolveResult
	json.Unmarshal(wm.Body.Bytes(), &m)
	if m.Lat == nil || *m.Lat != 51.2 {
		t.Fatalf("member must get coords: %+v", m)
	}
}

func TestResolveBadPrefix(t *testing.T) {
	h := &ResolveAPI{Upstreams: []string{"http://unused"}, Client: http.DefaultClient}
	r := httptest.NewRequest("GET", "/api/resolve?prefix=zz", nil)
	r = r.WithContext(context.WithValue(r.Context(), authCtxKey, Guest()))
	w := httptest.NewRecorder()
	h.Resolve(w, r)
	if w.Code != 400 {
		t.Fatalf("short/non-hex prefix should be 400, got %d", w.Code)
	}
}
