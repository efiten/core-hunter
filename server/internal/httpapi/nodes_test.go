package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A registry upstream, counting how often it is actually fetched — the cache
// claim is the whole reason this endpoint can exist (13k nodes is not a
// per-pan upstream call), so the count is asserted, not assumed.
func registryUpstream(hits *int32, body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
}

const twoNodes = `{"count":2,"nodes":[
	{"pubkey":"aa11","name":"Antwerpen","lat":51.2,"lon":4.4},
	{"pubkey":"bb22","name":"Groningen","lat":53.2,"lon":6.5}]}`

func nodesReq(bbox string, a Auth) *http.Request {
	r := httptest.NewRequest("GET", "/api/nodes/positions?bbox="+bbox, nil)
	return r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
}

func decodeNodes(t *testing.T, w *httptest.ResponseRecorder) nodePositionsResponse {
	t.Helper()
	var res nodePositionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return res
}

func TestNodePositionsForbiddenBelowMember(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	for _, a := range []Auth{Guest(), {Role: "hunter", Username: "h"}} {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq("50,3,54,7", a))
		if w.Code != 403 {
			t.Fatalf("role %q: got %d, want 403", a.Role, w.Code)
		}
	}
	// Not merely filtered out of the response: the upstream must never be
	// reached on behalf of a caller who may not see positions, or the endpoint
	// becomes a way to warm a cache the per-node path refuses to serve.
	if hits != 0 {
		t.Fatalf("upstream fetched %d times for a sub-member caller, want 0", hits)
	}
}

func TestNodePositionsReturnsOnlyNodesInBBox(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
	if w.Code != 200 {
		t.Fatalf("got %d, want 200", w.Code)
	}
	res := decodeNodes(t, w)
	if len(res.Nodes) != 1 || res.Nodes[0].Pubkey != "aa11" {
		t.Fatalf("bbox must exclude the far node: %+v", res.Nodes)
	}
	if res.Nodes[0].Name != "Antwerpen" || res.Nodes[0].Lat != 51.2 || res.Nodes[0].Lon != 4.4 {
		t.Fatalf("node fields lost in transit: %+v", res.Nodes[0])
	}
}

func TestNodePositionsRequiresBBox(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	for _, q := range []string{"", "50,3,54", "a,b,c,d"} {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq(q, Auth{Role: "member"}))
		if w.Code != 400 {
			t.Fatalf("bbox %q: got %d, want 400", q, w.Code)
		}
	}
}

func TestNodePositionsCachesAcrossRequests(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), TTL: time.Minute}

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
		if w.Code != 200 {
			t.Fatalf("request %d: got %d", i, w.Code)
		}
	}
	if hits != 1 {
		t.Fatalf("upstream fetched %d times, want 1 — a pan must not refetch the registry", hits)
	}
}

func TestNodePositionsRefetchesAfterTTL(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), TTL: time.Nanosecond}

	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
		time.Sleep(time.Millisecond)
	}
	if hits != 2 {
		t.Fatalf("upstream fetched %d times, want 2 — an expired cache must refetch", hits)
	}
}

func TestNodePositionsMergesUpstreamsAndDedupes(t *testing.T) {
	var h1, h2 int32
	// The same node in both registries, plus one only the second knows. The
	// duplicate must not be drawn twice, and the first upstream wins on a
	// conflict — the same precedence /api/resolve applies.
	a := registryUpstream(&h1, `{"nodes":[{"pubkey":"aa11","name":"FromSF7","lat":51.2,"lon":4.4}]}`)
	b := registryUpstream(&h2, `{"nodes":[
		{"pubkey":"aa11","name":"FromSF8","lat":51.9,"lon":4.9},
		{"pubkey":"cc33","name":"OnlySF8","lat":51.3,"lon":4.5}]}`)
	defer a.Close()
	defer b.Close()
	h := &NodesAPI{Upstreams: []string{a.URL, b.URL}, Client: a.Client()}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	if len(res.Nodes) != 2 {
		t.Fatalf("want 2 distinct nodes, got %+v", res.Nodes)
	}
	byKey := map[string]nodePosition{}
	for _, n := range res.Nodes {
		byKey[n.Pubkey] = n
	}
	if byKey["aa11"].Name != "FromSF7" || byKey["aa11"].Lat != 51.2 {
		t.Fatalf("first upstream must win on a conflict: %+v", byKey["aa11"])
	}
	if byKey["cc33"].Name != "OnlySF8" {
		t.Fatalf("a node only the second upstream knows must survive: %+v", byKey)
	}
}

func TestNodePositionsServesWarmCacheWhenUpstreamFails(t *testing.T) {
	var hits int32
	fail := int32(0)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if atomic.LoadInt32(&fail) == 1 {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, twoNodes)
	}))
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), TTL: time.Nanosecond}

	// The narrow bbox keeps this at one node, so "still served" is a claim about
	// the cached registry rather than about an empty filter passing everything.
	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
	if len(decodeNodes(t, w).Nodes) != 1 {
		t.Fatalf("warm-up request should have returned the in-bbox node: %s", w.Body.String())
	}

	atomic.StoreInt32(&fail, 1)
	time.Sleep(time.Millisecond)
	w2 := httptest.NewRecorder()
	h.Positions(w2, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
	// A registry that is a few minutes stale is worth far more than an error
	// page: the layer would otherwise empty itself on every upstream hiccup.
	if w2.Code != 200 || len(decodeNodes(t, w2).Nodes) != 1 {
		t.Fatalf("stale cache must still be served: %d %s", w2.Code, w2.Body.String())
	}
	if !decodeNodes(t, w2).Stale {
		t.Fatal("a served-from-stale-cache response must say so")
	}
}

func TestNodePositionsErrorsWithNothingCached(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if w.Code != 503 {
		t.Fatalf("cold cache + dead upstream: got %d, want 503", w.Code)
	}
}

func TestNodePositionsCapsAndFlagsTruncation(t *testing.T) {
	var hits int32
	body := `{"nodes":[`
	for i := 0; i < 5; i++ {
		if i > 0 {
			body += ","
		}
		body += fmt.Sprintf(`{"pubkey":"n%d","name":"N%d","lat":51.%d,"lon":4.4}`, i, i, i)
	}
	body += `]}`
	up := registryUpstream(&hits, body)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Cap: 3}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	if len(res.Nodes) != 3 || !res.Truncated {
		t.Fatalf("cap must apply and be reported: %d nodes, truncated=%v", len(res.Nodes), res.Truncated)
	}
}

func TestNodePositionsSkipsNodesWithoutCoordinates(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, `{"nodes":[
		{"pubkey":"aa11","name":"Placed","lat":51.2,"lon":4.4},
		{"pubkey":"bb22","name":"NoCoords"}]}`)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	// 0,0 is a real coordinate off West Africa (the same trap §9 records for
	// the ingestor's gps fields), so a node with no position must be dropped
	// rather than defaulted into the Gulf of Guinea.
	if len(res.Nodes) != 1 || res.Nodes[0].Pubkey != "aa11" {
		t.Fatalf("a node without coordinates must not be returned: %+v", res.Nodes)
	}
}

func TestNodePositionsSaysWhenUnconfigured(t *testing.T) {
	// No upstreams configured: the honest answer is an error, not an empty
	// registry that the layer cannot tell apart from "nothing in view".
	h := &NodesAPI{}
	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if w.Code != 503 {
		t.Fatalf("got %d, want 503", w.Code)
	}
	if !strings.Contains(w.Body.String(), "not_configured") {
		t.Fatalf("the error must name the cause: %s", w.Body.String())
	}
}
