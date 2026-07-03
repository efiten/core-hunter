package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

type ResolveAPI struct {
	Upstreams []string
	Client    *http.Client
}

type resolveResult struct {
	Prefix    string   `json:"prefix"`
	Pubkey    string   `json:"pubkey,omitempty"`
	Name      string   `json:"name,omitempty"`
	Ambiguous bool     `json:"ambiguous"`
	Lat       *float64 `json:"lat,omitempty"`
	Lon       *float64 `json:"lon,omitempty"`
}

var hexRe = regexp.MustCompile(`^[0-9a-fA-F]{4,}$`)

// Resolve fans out ?prefix= to the configured upstreams, returns the first
// unambiguous hit. Strips lat/lon unless the caller AtLeast("member").
func (h *ResolveAPI) Resolve(w http.ResponseWriter, r *http.Request) {
	prefix := r.URL.Query().Get("prefix")
	if !hexRe.MatchString(prefix) {
		writeErr(w, 400, "bad_prefix")
		return
	}
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	var best *resolveResult
	for _, up := range h.Upstreams {
		u := up + "?prefix=" + url.QueryEscape(prefix)
		resp, err := client.Get(u)
		if err != nil {
			continue
		}
		var res resolveResult
		err = json.NewDecoder(resp.Body).Decode(&res)
		resp.Body.Close()
		if err != nil {
			continue
		}
		if res.Name != "" && !res.Ambiguous {
			best = &res
			break
		}
		if best == nil {
			best = &res
		}
	}
	if best == nil {
		best = &resolveResult{Prefix: prefix, Ambiguous: true}
	}
	if !AuthOf(r).AtLeast("member") {
		best.Lat, best.Lon = nil, nil
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(best)
}
