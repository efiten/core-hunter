package httpapi

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Bulk node-registry proxy (#377). The website's node-position layer could
// only ever draw nodes it had personally heard, because it derived them from
// the filtered reception set — so the same layer meant a strictly smaller
// thing on the surface with the bigger screen. The app avoids that by
// bulk-fetching the whole registry and narrowing it to the viewport; this is
// the same source, proxied same-origin so the website can do it too.
//
// Why bbox-filtered here rather than shipped whole and filtered in the
// browser, as the app does: the registry is ~9,500 positioned nodes / 1.3 MB
// per upstream (measured 2026-08-17). The app pays that once on a device that
// is already committed to a hunt; a website pays it per visitor, on whatever
// connection they arrived on. Filtering server-side turns that into a few kB
// per pan, off one upstream fetch per TTL shared by every visitor, which is
// also the shape /api/heatmap already has. AGENTS.md §7's rule is about
// per-packet calls, and this is neither: one request per view, not per node.

type nodePosition struct {
	Pubkey string  `json:"pubkey"`
	Name   string  `json:"name,omitempty"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
}

type nodePositionsResponse struct {
	Nodes     []nodePosition `json:"nodes"`
	Truncated bool           `json:"truncated,omitempty"`
	// Stale says the registry behind this answer could not be refreshed and is
	// older than the TTL. The layer keeps drawing; the caller can say so.
	Stale bool `json:"stale,omitempty"`
}

// The upstream payload (nameresolver's /api/nodes/positions, and the
// CoreScope-compatible shape behind the same path).
type upstreamPositions struct {
	Nodes []nodePosition `json:"nodes"`
}

const (
	defaultNodeCacheTTL = 10 * time.Minute
	defaultNodeCap      = 20000
)

type NodesAPI struct {
	Upstreams []string
	Client    *http.Client
	// TTL for the cached registry; zero means defaultNodeCacheTTL.
	TTL time.Duration
	// Cap on nodes returned per request; zero means defaultNodeCap.
	Cap int

	mu         sync.Mutex
	fetchMu    sync.Mutex
	cache      []nodePosition
	fetched    time.Time
	haveData   bool
	refreshing bool
	// True when the last completed fetch succeeded but returned nothing. An
	// upstream answering 200 with an empty registry is a broken upstream, not a
	// world with no nodes in it, and the layer cannot tell the difference.
	emptyUpstream bool
}

func (h *NodesAPI) ttl() time.Duration {
	if h.TTL > 0 {
		return h.TTL
	}
	return defaultNodeCacheTTL
}

func (h *NodesAPI) cap() int {
	if h.Cap > 0 {
		return h.Cap
	}
	return defaultNodeCap
}

func (h *NodesAPI) client() *http.Client {
	if h.Client != nil {
		return h.Client
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// registry returns the cached node set, refreshing it when the TTL has passed.
//
// The mutex is never held across the upstream fetch. It used to be, which meant
// every member request arriving after the TTL expired queued behind one slow
// registry — up to the client timeout — while a perfectly serviceable set sat in
// memory. A warm cache is now served immediately and refreshed in the
// background; only a cold one blocks, and then only one caller fetches while the
// rest wait for that same result.
//
// `stale` says the answer did not come from a fresh fetch: either a refresh is
// still running, or the last one failed. Both are cases where a registry a few
// minutes old beats an empty layer, and the caller is told which it got.
func (h *NodesAPI) registry() (nodes []nodePosition, stale bool, ok bool) {
	h.mu.Lock()
	cache, fetched, have, empty := h.cache, h.fetched, h.haveData, h.emptyUpstream
	if have && time.Since(fetched) < h.ttl() {
		h.mu.Unlock()
		return cache, false, true
	}
	if have {
		// Warm but due: hand back what we have and refresh behind the request.
		if !h.refreshing {
			h.refreshing = true
			go func() { h.refreshOnce(); h.mu.Lock(); h.refreshing = false; h.mu.Unlock() }()
		}
		h.mu.Unlock()
		return cache, true, true
	}
	if empty && time.Since(fetched) < h.ttl() {
		// A recent fetch succeeded and returned nothing. Do not hammer the
		// upstreams once per request while that is true.
		h.mu.Unlock()
		return nil, false, false
	}
	h.mu.Unlock()

	h.refreshOnce()

	h.mu.Lock()
	defer h.mu.Unlock()
	return h.cache, false, h.haveData
}

// refreshOnce fetches the registry and stores it, with at most one fetch in
// flight: a cold start under concurrent load must not become one upstream
// request per caller. Callers that arrive during a fetch wait for it and then
// read the result the first one stored.
func (h *NodesAPI) refreshOnce() {
	h.fetchMu.Lock()
	defer h.fetchMu.Unlock()
	// Someone else may have filled it while this caller waited for the lock.
	h.mu.Lock()
	if h.haveData && time.Since(h.fetched) < h.ttl() {
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()

	fresh, err := h.fetchAll()
	h.mu.Lock()
	defer h.mu.Unlock()
	if err != nil {
		return // keep whatever is cached; the caller reports it as stale
	}
	if len(fresh) == 0 {
		// Every upstream answered, and between them they know no positioned
		// node. Treat that as unusable rather than caching an empty registry
		// the layer would render as "nothing here" (#398 review).
		h.fetched, h.emptyUpstream = time.Now(), true
		return
	}
	h.cache, h.fetched, h.haveData, h.emptyUpstream = fresh, time.Now(), true, false
}

// fetchAll merges every upstream, first one wins on a duplicate pubkey — the
// same precedence /api/resolve applies when two registries claim one id.
// Nodes without a usable position are dropped here rather than at render time:
// a missing lat/lon decodes as 0,0, which is a real coordinate in the Gulf of
// Guinea, the same trap §9 records for the ingestor's gps fields.
func (h *NodesAPI) fetchAll() ([]nodePosition, error) {
	seen := map[string]bool{}
	var out []nodePosition
	var firstErr error
	for _, up := range h.Upstreams {
		resp, err := h.client().Get(up)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			if firstErr == nil {
				firstErr = errUpstreamStatus
			}
			continue
		}
		var body upstreamPositions
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, n := range body.Nodes {
			if n.Pubkey == "" || (n.Lat == 0 && n.Lon == 0) || seen[n.Pubkey] {
				continue
			}
			seen[n.Pubkey] = true
			out = append(out, n)
		}
	}
	if out == nil && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

type upstreamStatusError struct{}

func (upstreamStatusError) Error() string { return "upstream status" }

var errUpstreamStatus = upstreamStatusError{}

// Positions serves the registry nodes inside ?bbox=minLat,minLon,maxLat,maxLon.
//
// Member-gated, and the gate is checked before anything else: /api/resolve
// strips lat/lon below member (resolve.go), so a bulk endpoint that fetched
// first and filtered after would be a way to reach the positions the per-node
// path refuses — including warming a shared cache on a guest's request.
func (h *NodesAPI) Positions(w http.ResponseWriter, r *http.Request) {
	if !AuthOf(r).AtLeast("member") {
		writeErr(w, 403, "forbidden")
		return
	}
	minLat, minLon, maxLat, maxLon, ok := ParseBBox(r.URL.Query().Get("bbox"))
	if !ok {
		writeErr(w, 400, "bad_bbox")
		return
	}
	// An unconfigured deployment must say so rather than serve an empty
	// registry: "no upstreams" and "no nodes in view" are indistinguishable to
	// the layer, and the silent version is a map that quietly shows nothing.
	if len(h.Upstreams) == 0 {
		writeErr(w, 503, "registry_not_configured")
		return
	}
	nodes, stale, have := h.registry()
	if !have {
		h.mu.Lock()
		empty := h.emptyUpstream
		h.mu.Unlock()
		if empty {
			// Reachable and answering, with nothing in it. Distinct from an
			// unreachable one, and both are distinct from "nothing in view".
			writeErr(w, 503, "registry_empty")
			return
		}
		writeErr(w, 503, "registry_unavailable")
		return
	}
	res := nodePositionsResponse{Nodes: []nodePosition{}, Stale: stale}
	for _, n := range nodes {
		if n.Lat < minLat || n.Lat > maxLat || n.Lon < minLon || n.Lon > maxLon {
			continue
		}
		if len(res.Nodes) >= h.cap() {
			res.Truncated = true
			break
		}
		res.Nodes = append(res.Nodes, n)
	}
	writeJSON(w, res)
}
