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

	mu       sync.Mutex
	cache    []nodePosition
	fetched  time.Time
	haveData bool
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
// `stale` is true when a refresh was due but failed and the previous set is
// being served anyway — a registry a few minutes old beats an empty layer, and
// the caller is told which it got.
func (h *NodesAPI) registry() (nodes []nodePosition, stale bool, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.haveData && time.Since(h.fetched) < h.ttl() {
		return h.cache, false, true
	}
	fresh, err := h.fetchAll()
	if err != nil {
		// Only the cold-cache case is a failure the caller has to see.
		return h.cache, true, h.haveData
	}
	h.cache, h.fetched, h.haveData = fresh, time.Now(), true
	return h.cache, false, true
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
