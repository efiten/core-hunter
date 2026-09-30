package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
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
		if r.URL.Query().Get("offset") != "" {
			// This stand-in speaks the whole-registry shape, so a second page is
			// empty. Without that, code that paged when it should not would spin
			// on the same rows until the page cap and hang the suite instead of
			// failing it.
			fmt.Fprint(w, `{"nodes":[]}`)
			return
		}
		fmt.Fprint(w, body)
	}))
}

const twoNodes = `{"count":2,"nodes":[
	{"pubkey":"aa11","name":"Antwerpen","lat":51.2,"lon":4.4},
	{"pubkey":"bb22","name":"Groningen","lat":53.2,"lon":6.5}]}`

// warmed is the API after the fetch Run does at boot. Positions itself never
// reaches an upstream (#591), so a test about what it serves fetches first.
func warmed(h *NodesAPI) *NodesAPI {
	h.refresh()
	return h
}

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
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

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
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

	for _, q := range []string{"", "50,3,54", "a,b,c,d"} {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq(q, Auth{Role: "member"}))
		if w.Code != 400 {
			t.Fatalf("bbox %q: got %d, want 400", q, w.Code)
		}
	}
}

func TestNodePositionsNeverFetchesOnARequest(t *testing.T) {
	// #591: a member's request used to carry the cold fetch, the whole registry
	// walk with the client timeout per page, and a proxy with less patience
	// answered 504 for it. Cold or warm, a request reads memory and nothing else.
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "registry_unavailable") {
		t.Fatalf("cold: got %d %s, want 503 registry_unavailable", w.Code, w.Body.String())
	}
	if hits != 0 {
		t.Fatalf("a cold request fetched the upstream %d times, want 0", hits)
	}

	h.refresh()
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

// positionsCode asks for the whole test area as a member and answers the status.
func positionsCode(h *NodesAPI) int {
	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	return w.Code
}

// eventually polls cond for up to two seconds: Run works on its own goroutine,
// so what it stored is observed, not awaited.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("never happened: %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestNodesRunWarmsTheRegistryAtBoot(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	// An hour between refreshes: what answers below is the fetch at boot.
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Interval: time.Hour}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.Run(ctx)

	eventually(t, "a 200 without any request having fetched", func() bool { return positionsCode(h) == 200 })
}

func TestNodesRunRefreshesOnATimer(t *testing.T) {
	// The second fetch carries a node the first did not: the registry served
	// must become the newer one with no request in between asking for it.
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if atomic.AddInt32(&hits, 1) == 1 {
			fmt.Fprint(w, `{"nodes":[{"pubkey":"aa11","lat":51.2,"lon":4.4}]}`)
			return
		}
		fmt.Fprint(w, twoNodes)
	}))
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Interval: 5 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.Run(ctx)

	eventually(t, "the refreshed registry being served", func() bool {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
		return w.Code == 200 && len(decodeNodes(t, w).Nodes) == 2
	})
}

func TestNodesRunAsksAgainSoonAfterAFailedFetch(t *testing.T) {
	// A fetch at boot that fails leaves nothing in memory. With an hour to the
	// next refresh, the only way to a 200 here is the retry.
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(502)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, twoNodes)
	}))
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Interval: time.Hour, Retry: 5 * time.Millisecond,
		Logf: func(string, ...any) {}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.Run(ctx)

	eventually(t, "a 200 after the first fetch failed", func() bool { return positionsCode(h) == 200 })
}

func TestNodesRunStopsWithItsContext(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Interval: time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.Run(ctx); close(done) }()
	eventually(t, "a first fetch", func() bool { return atomic.LoadInt32(&hits) > 0 })
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run kept going after its context was cancelled")
	}
}

func TestNodesLogAFailedFetchWithItsURLAndError(t *testing.T) {
	// #591: the fetch error was dropped, so an outage seen on a phone could not
	// be read back from the log, nor which of the upstreams it was.
	good := registryUpstream(new(int32), twoNodes)
	defer good.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	}))
	defer bad.Close()
	var lines []string
	h := &NodesAPI{Upstreams: []string{good.URL, bad.URL + "/sf8/api/nodes/positions"}, Client: good.Client(),
		Logf: func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }}

	h.refresh()
	if len(lines) != 1 {
		t.Fatalf("one failed upstream is one line, got %q", lines)
	}
	if !strings.Contains(lines[0], bad.URL+"/sf8/api/nodes/positions") || !strings.Contains(lines[0], "404") {
		t.Fatalf("the line must name the URL and the error: %q", lines[0])
	}
	// A request is not a fetch, so it logs nothing either.
	for i := 0; i < 3; i++ {
		positionsCode(h)
	}
	if len(lines) != 1 {
		t.Fatalf("requests must not add lines: %q", lines)
	}
}

func TestNodesLogAPageThatFailsAfterTheFirst(t *testing.T) {
	// A later page failing keeps what the earlier ones gave, which makes it a
	// registry that is silently short. The line is the only trace of it.
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("offset") != "" {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"nodes":[{"public_key":"a","lat":51,"lon":4},{"public_key":"b","lat":51,"lon":4}]}`)
	}))
	defer up.Close()
	var lines []string
	h := &NodesAPI{Upstreams: []string{up.URL + "?limit=2"}, Client: up.Client(),
		Logf: func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }}

	if !h.refresh() {
		t.Fatal("the first page is a registry")
	}
	if len(lines) != 1 || !strings.Contains(lines[0], "offset=2") || !strings.Contains(lines[0], "500") {
		t.Fatalf("want one line naming the failed page and its status, got %q", lines)
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
	h := warmed(&NodesAPI{Upstreams: []string{a.URL, b.URL}, Client: a.Client()})

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
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Logf: func(string, ...any) {}})

	// The narrow bbox keeps this at one node, so "still served" is a claim about
	// the cached registry rather than about an empty filter passing everything.
	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
	if res := decodeNodes(t, w); len(res.Nodes) != 1 || res.Stale {
		t.Fatalf("the warm registry should have returned the in-bbox node, not stale: %s", w.Body.String())
	}

	atomic.StoreInt32(&fail, 1)
	h.refresh()
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

	// And the mark goes once a refresh gives a registry again.
	atomic.StoreInt32(&fail, 0)
	h.refresh()
	w3 := httptest.NewRecorder()
	h.Positions(w3, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
	if decodeNodes(t, w3).Stale {
		t.Fatal("a refreshed registry must not be served as stale")
	}
}

func TestNodePositionsErrorsWithNothingCached(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer up.Close()
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Logf: func(string, ...any) {}})

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "registry_unavailable") {
		t.Fatalf("cold cache + dead upstream: got %d %s, want 503 registry_unavailable", w.Code, w.Body.String())
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
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client(), Cap: 3})

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
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

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

func TestNodePositionsDoesNotWaitForARefreshInFlight(t *testing.T) {
	// A refresh that hangs on a slow registry must cost a visitor nothing: the
	// set in memory answers at once, and it is not stale, since no refresh has
	// failed.
	release := make(chan struct{})
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) > 1 {
			<-release // second and later fetches hang until the test says so
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, twoNodes)
	}))
	defer up.Close()
	defer close(release)
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

	go h.refresh()
	eventually(t, "the second fetch reaching the upstream", func() bool { return atomic.LoadInt32(&hits) == 2 })

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		h.Positions(w, nodesReq("50.5,3.0,52.0,5.0", Auth{Role: "member"}))
		done <- w
	}()
	select {
	case w := <-done:
		res := decodeNodes(t, w)
		if len(res.Nodes) != 1 || res.Stale {
			t.Fatalf("the set in memory must be served at once, and not as stale: %+v", res)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("request blocked on the in-flight refresh instead of serving the cached set")
	}
}

func TestNodePositionsSaysWhenTheRegistryIsEmpty(t *testing.T) {
	// Every upstream answers, and between them they know no positioned node.
	// That is a broken registry, not a world with no nodes in it — and the
	// layer cannot tell an empty answer from "nothing in view" (#398 review).
	var hits int32
	up := registryUpstream(&hits, `{"count":0,"nodes":[]}`)
	defer up.Close()
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "registry_empty") {
		t.Fatalf("got %d %s, want 503 registry_empty", w.Code, w.Body.String())
	}
}

func TestNodePositionsKeepTheRegistryWhenARefreshComesBackEmpty(t *testing.T) {
	// An upstream that starts answering 200 with nothing in it is broken, not
	// a world that lost its nodes: the registry in memory stays, marked stale.
	empty := int32(0)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if atomic.LoadInt32(&empty) == 1 {
			fmt.Fprint(w, `{"count":0,"nodes":[]}`)
			return
		}
		fmt.Fprint(w, twoNodes)
	}))
	defer up.Close()
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

	atomic.StoreInt32(&empty, 1)
	if h.refresh() {
		t.Fatal("an empty answer is no registry, so Run must ask again soon")
	}
	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	if res := decodeNodes(t, w); w.Code != 200 || len(res.Nodes) != 2 || !res.Stale {
		t.Fatalf("got %d %s, want the two cached nodes marked stale", w.Code, w.Body.String())
	}
}

// CoreScope (the SF8 registry) has no /positions route at all, but its
// /api/nodes does carry lat/lon — under `public_key` rather than `pubkey`, 50
// rows at a time, capped at 2000 per page with an `offset` to walk them (#418,
// measured against the live service 2026-08-19). Supporting that shape is what
// puts SF8 nodes back on the map; the alternative was an upstream feature
// request for a route the data does not need.
const csPage = `{"total":2,"nodes":[
	{"public_key":"cs01","name":"Smuty","lat":51.09,"lon":6.98,"role":"repeater","advert_count":1477},
	{"public_key":"cs02","name":"Venlo","lat":51.37,"lon":6.17}]}`

func TestNodePositionsAcceptsTheCoreScopeShape(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, csPage)
	defer up.Close()
	h := warmed(&NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()})

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	if len(res.Nodes) != 2 {
		t.Fatalf("public_key rows must be read: %+v", res.Nodes)
	}
	byKey := map[string]nodePosition{}
	for _, n := range res.Nodes {
		byKey[n.Pubkey] = n
	}
	if byKey["cs01"].Name != "Smuty" || byKey["cs01"].Lat != 51.09 {
		t.Fatalf("fields lost mapping public_key -> pubkey: %+v", byKey["cs01"])
	}
}

func TestNodePositionsMergesTheTwoRegistryShapes(t *testing.T) {
	// The same node in both registries, named differently, plus one each. The
	// nameresolver comes first in config order, so it wins the conflict.
	var h1, h2 int32
	sf7 := registryUpstream(&h1, `{"count":2,"nodes":[
		{"pubkey":"shared","name":"FromSF7","lat":51.2,"lon":4.4},
		{"pubkey":"only7","name":"Only7","lat":51.3,"lon":4.5}]}`)
	sf8 := registryUpstream(&h2, `{"total":2,"nodes":[
		{"public_key":"shared","name":"FromSF8","lat":51.9,"lon":4.9},
		{"public_key":"only8","name":"Only8","lat":51.4,"lon":4.6}]}`)
	defer sf7.Close()
	defer sf8.Close()
	h := warmed(&NodesAPI{Upstreams: []string{sf7.URL, sf8.URL}, Client: sf7.Client()})

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	if len(res.Nodes) != 3 {
		t.Fatalf("want shared + only7 + only8, got %+v", res.Nodes)
	}
	for _, n := range res.Nodes {
		if n.Pubkey == "shared" && n.Name != "FromSF7" {
			t.Fatalf("first upstream must still win a conflict across shapes: %+v", n)
		}
	}
}

func TestNodePositionsWalksPagesWhenTheURLAsksForThem(t *testing.T) {
	// CoreScope caps a page at its `limit` and answers `offset`. The config URL
	// carrying ?limit= is what opts an upstream into paging — the nameresolver
	// has no limit and returns everything, so it must stay a single request.
	var reqs int32
	rows := []string{`{"public_key":"a","lat":51,"lon":4}`, `{"public_key":"b","lat":51,"lon":4}`,
		`{"public_key":"c","lat":51,"lon":4}`, `{"public_key":"d","lat":51,"lon":4}`, `{"public_key":"e","lat":51,"lon":4}`}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&reqs, 1)
		off, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		lim, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if lim == 0 {
			lim = 2
		}
		end := off + lim
		if end > len(rows) {
			end = len(rows)
		}
		page := []string{}
		if off < len(rows) {
			page = rows[off:end]
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"total":%d,"nodes":[%s]}`, len(page), strings.Join(page, ","))
	}))
	defer up.Close()
	h := warmed(&NodesAPI{Upstreams: []string{up.URL + "/api/nodes?limit=3"}, Client: up.Client()})

	w := httptest.NewRecorder()
	h.Positions(w, nodesReq("50,3,54,7", Auth{Role: "member"}))
	res := decodeNodes(t, w)
	if len(res.Nodes) != 5 {
		t.Fatalf("paging must reach every row: got %d", len(res.Nodes))
	}
	// 3 then 2: the short page ends it. Pinned against the page size the URL
	// asks for, not a round number, so a hardcoded stride fails here.
	if reqs != 2 {
		t.Fatalf("3+2 rows is 2 requests, got %d", reqs)
	}
}

func TestNodePositionsDoesNotPageAnUpstreamWithoutALimit(t *testing.T) {
	var hits int32
	up := registryUpstream(&hits, twoNodes)
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL}, Client: up.Client()}

	h.refresh()
	if hits != 1 {
		t.Fatalf("an upstream with no ?limit= returns everything at once: %d requests", hits)
	}
}

func TestNodePositionsStopsPagingAtTheCap(t *testing.T) {
	// An upstream that always answers a full page would otherwise be walked
	// forever. The cap bounds it; the layer would rather be short than hang.
	var reqs int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&reqs, 1)
		// Past the cap the upstream stops answering, so a missing cap fails this
		// test instead of hanging it: without the bound the loop is infinite,
		// and a test that never returns is a worse signal than a red one.
		if int(n) > maxRegistryPages+2 {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"nodes":[{"public_key":"k%d","lat":51,"lon":4},{"public_key":"j%d","lat":51,"lon":4}]}`, n, n)
	}))
	defer up.Close()
	h := &NodesAPI{Upstreams: []string{up.URL + "?limit=2"}, Client: up.Client()}

	h.refresh()
	if reqs > int32(maxRegistryPages) {
		t.Fatalf("paging ran %d times, cap is %d", reqs, maxRegistryPages)
	}
	if reqs < 2 {
		t.Fatalf("it should page at least twice before the cap: %d", reqs)
	}
}
