package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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
// per pan, off one registry in memory shared by every visitor, which is
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
	// Stale says the last refresh of the registry behind this answer gave none,
	// so it is older than one refresh interval. The layer keeps drawing; the
	// caller can say so.
	Stale bool `json:"stale,omitempty"`
}

// The two registry shapes this proxies, decoded through one struct (#418):
//
//	nameresolver  GET .../api/nodes/positions  → {count, nodes:[{pubkey,name,lat,lon}]}
//	CoreScope     GET .../api/nodes?limit=2000 → {total, nodes:[{public_key,name,lat,lon,…}]}
//
// CoreScope has no /positions route at all, which is why the website's layer
// covered SF7 only until this landed. Its /api/nodes carries the same three
// facts under a different key, so the difference is a field name and a page
// size rather than missing data.
//
// lat/lon are pointers to keep "absent" distinct from 0 — 0,0 is a real
// coordinate off West Africa, the trap §9 records for the ingestor's gps.
type upstreamNode struct {
	Pubkey    string   `json:"pubkey"`
	PublicKey string   `json:"public_key"`
	Name      string   `json:"name"`
	Lat       *float64 `json:"lat"`
	Lon       *float64 `json:"lon"`
}

func (u upstreamNode) key() string {
	if u.Pubkey != "" {
		return u.Pubkey
	}
	return u.PublicKey
}

type upstreamPositions struct {
	Nodes []upstreamNode `json:"nodes"`
}

const (
	defaultNodeRefresh = 10 * time.Minute
	// How soon Run asks again after a refresh that gave no registry. When the
	// fetch at boot fails there is nothing in memory, and waiting a whole
	// interval would leave the layer without positions for ten minutes after
	// an upstream that was down for a moment.
	defaultNodeRetry = 30 * time.Second
	defaultNodeCap   = 20000
	// Pages walked per upstream before giving up. CoreScope's ~2,500 nodes are
	// two pages of 2000; the cap is the backstop against an upstream that
	// always answers a full page, where the layer would rather be short than
	// leave the fetch running.
	maxRegistryPages = 20
)

type NodesAPI struct {
	Upstreams []string
	Client    *http.Client
	// How often Run refreshes the registry; zero means defaultNodeRefresh.
	Interval time.Duration
	// How soon Run asks again after a refresh that gave no registry; zero
	// means defaultNodeRetry.
	Retry time.Duration
	// Cap on nodes returned per request; zero means defaultNodeCap.
	Cap int
	// Where a failed upstream fetch is reported; nil means log.Printf.
	Logf func(format string, args ...any)

	mu       sync.Mutex
	cache    []nodePosition
	haveData bool
	// True when the last refresh gave no registry: the cache, if there is one,
	// is older than one interval.
	stale bool
	// True when the last refresh answered and returned nothing. An upstream
	// answering 200 with an empty registry is a broken upstream, not a world
	// with no nodes in it, and the layer cannot tell the difference.
	emptyUpstream bool
}

func (h *NodesAPI) interval() time.Duration {
	if h.Interval > 0 {
		return h.Interval
	}
	return defaultNodeRefresh
}

func (h *NodesAPI) retry() time.Duration {
	if h.Retry > 0 {
		return h.Retry
	}
	return defaultNodeRetry
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

func (h *NodesAPI) logf(format string, args ...any) {
	if h.Logf != nil {
		h.Logf(format, args...)
		return
	}
	log.Printf(format, args...)
}

// Run keeps the registry in memory until ctx is done: one fetch at boot, then
// one per Interval (#591).
//
// The fetch used to ride on a member's request whenever the cache was cold,
// which is the state after every restart. That request carried the whole
// registry walk, up to the client timeout per page, and a reverse proxy with
// less patience answered 504 for it; while the upstreams failed, every request
// re-ran the fetch and failed the same way. Positions now only reads what this
// loop stored, so how long an upstream takes is never a visitor's wait.
func (h *NodesAPI) Run(ctx context.Context) {
	if len(h.Upstreams) == 0 {
		return
	}
	for {
		wait := h.interval()
		if !h.refresh() {
			wait = min(wait, h.retry())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// refresh fetches the registry once and stores it, and reports whether the
// fetch gave one. A fetch that failed or came back empty keeps whatever is
// cached: a registry a few minutes old beats an empty layer, and the answers
// served from it say so (`stale`).
func (h *NodesAPI) refresh() bool {
	fresh, err := h.fetchAll()
	h.mu.Lock()
	defer h.mu.Unlock()
	if err != nil {
		h.stale, h.emptyUpstream = true, false
		return false
	}
	if len(fresh) == 0 {
		// Every upstream answered, and between them they know no positioned
		// node. Treat that as unusable rather than caching an empty registry
		// the layer would render as "nothing here" (#398 review).
		h.stale, h.emptyUpstream = true, true
		return false
	}
	h.cache, h.haveData, h.stale, h.emptyUpstream = fresh, true, false, false
	return true
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
		rows, err := h.fetchUpstream(up)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, n := range rows {
			k := n.key()
			if k == "" || n.Lat == nil || n.Lon == nil || (*n.Lat == 0 && *n.Lon == 0) || seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, nodePosition{Pubkey: k, Name: n.Name, Lat: *n.Lat, Lon: *n.Lon})
		}
	}
	if out == nil && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// pageSize reads the `limit` the configured URL asks for. Its presence is what
// opts an upstream into paging: the nameresolver returns its whole registry in
// one answer and must stay one request, while CoreScope caps a page and
// answers `offset`. Operator-controlled rather than sniffed, so a registry that
// changes its paging is a config edit and not a code change.
func pageSize(raw string) int {
	u, err := url.Parse(raw)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(u.Query().Get("limit"))
	if n < 1 {
		return 0
	}
	return n
}

// fetchUpstream walks one registry, following `offset` while it keeps handing
// back full pages. A short page ends it — no total is needed, and CoreScope's
// `total` cannot serve as one anyway: it reports the page size, not the set.
//
// A page that fails is logged with its URL and the error (#591). The error
// used to be dropped, so a registry the server could not reach left nothing to
// read back: not that it failed, nor which URL.
func (h *NodesAPI) fetchUpstream(raw string) ([]upstreamNode, error) {
	limit := pageSize(raw)
	var all []upstreamNode
	for page := 0; page < maxRegistryPages; page++ {
		target := raw
		if limit > 0 && page > 0 {
			sep := "?"
			if strings.Contains(raw, "?") {
				sep = "&"
			}
			target = raw + sep + "offset=" + strconv.Itoa(page*limit)
		}
		rows, err := h.fetchPage(target)
		if err != nil {
			h.logf("node registry: %s: %v", target, err)
			if page == 0 {
				return nil, err
			}
			break // keep what the earlier pages gave
		}
		all = append(all, rows...)
		if limit == 0 || len(rows) < limit {
			break
		}
	}
	return all, nil
}

func (h *NodesAPI) fetchPage(target string) ([]upstreamNode, error) {
	resp, err := h.client().Get(target)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var body upstreamPositions
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Nodes, nil
}

// Positions serves the registry nodes inside ?bbox=minLat,minLon,maxLat,maxLon.
//
// Member-gated, and the gate is checked before anything else: /api/resolve
// strips lat/lon below member (resolve.go), so a bulk endpoint that read the
// registry first and filtered after would be a way to reach the positions the
// per-node path refuses.
//
// Served from memory only (#591): Run fetches, this never does. Before the
// first fetch has landed the answer is registry_unavailable, at once.
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
	h.mu.Lock()
	nodes, stale, have, empty := h.cache, h.stale, h.haveData, h.emptyUpstream
	h.mu.Unlock()
	if !have {
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
