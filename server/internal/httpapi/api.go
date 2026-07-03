package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/geo"
	"github.com/efiten/core-hunter/server/internal/query"
	"github.com/efiten/core-hunter/server/internal/store"
	"github.com/efiten/core-hunter/server/internal/version"
)

func ParseBBox(s string) (minLat, minLon, maxLat, maxLon float64, ok bool) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 { return }
	v := make([]float64, 4)
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil { return 0, 0, 0, 0, false }
		v[i] = f
	}
	return v[0], v[1], v[2], v[3], true
}

func filterFrom(r *http.Request, baseIgnore []string) store.Filter {
	q := r.URL.Query()
	f := store.Filter{From: q.Get("from"), To: q.Get("to"), Hunter: q.Get("hunter"), Sender: q.Get("sender")}
	if minLat, minLon, maxLat, maxLon, ok := ParseBBox(q.Get("bbox")); ok {
		f.HasBBox, f.MinLat, f.MinLon, f.MaxLat, f.MaxLon = true, minLat, minLon, maxLat, maxLon
	}
	// Server-configured ignore list is always enforced, merged with any per-request ?ignore=.
	f.Ignore = append([]string(nil), baseIgnore...)
	if ig := strings.TrimSpace(q.Get("ignore")); ig != "" {
		f.Ignore = append(f.Ignore, strings.Split(ig, ",")...)
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil { f.Limit = n }
	if n, err := strconv.Atoi(q.Get("offset")); err == nil { f.Offset = n }
	// ?hops=<n> filters on exact hop count (direct-only = hops=0, #142);
	// ?types=a,b,c filters on packet_type (same values as the app's filter).
	if n, err := strconv.Atoi(q.Get("hops")); err == nil { f.Hops = &n }
	if ts := strings.TrimSpace(q.Get("types")); ts != "" {
		for _, t := range strings.Split(ts, ",") {
			if t = strings.TrimSpace(t); t != "" { f.Types = append(f.Types, t) }
		}
	}
	return f
}

// resolveHunterFilter maps a pseudonym token to the real pubkey and blanks a raw
// pubkey that isn't the sub-member caller's own companion (prevents cross-hunter targeting).
func resolveHunterFilter(f store.Filter, a Auth, ps auth.Pseudonyms) store.Filter {
	if f.Hunter == "" { return f }
	if n, ok := auth.ParsePseudonym(f.Hunter); ok {
		f.Hunter = pubkeyForOrdinal(ps, n) // "" if none -> query returns nothing
	} else if !a.ownsCompanion(strings.ToLower(f.Hunter)) {
		f.Hunter = ""
	}
	return f
}

// degradeFilter applies the guest window+cap and resolves a pseudonym hunter
// token to a real pubkey for sub-member callers. Returns the adjusted filter.
func degradeFilter(f store.Filter, a Auth, ps auth.Pseudonyms, now time.Time) store.Filter {
	if a.AtLeast("member") { return f }
	return resolveHunterFilter(applyGuestWindowCap(f, now), a, ps)
}

// applyGuestWindowCap forces the 24h window + 500-row cap onto f (used for
// any view of a sub-member caller that isn't their own full-history data).
func applyGuestWindowCap(f store.Filter, now time.Time) store.Filter {
	if f.From == "" || f.From < windowFrom(now) { f.From = windowFrom(now) }
	if f.Limit <= 0 || f.Limit > guestPointCap { f.Limit = guestPointCap }
	return f
}

func pubkeyForOrdinal(ps auth.Pseudonyms, n int) string {
	for pk, ord := range ps {
		if ord == n { return pk }
	}
	return ""
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

const heatmapCap = 50000

type Deps struct {
	Auth    *AuthAPI
	Admin   *AdminAPI
	Resolve *ResolveAPI
}

func RegisterRoutes(mux *http.ServeMux, s *store.Store, ignore []string, cs *store.CSReader, deps *Deps) {
	mux.HandleFunc("/api/points", func(w http.ResponseWriter, r *http.Request) {
		a := AuthOf(r)
		f := filterFrom(r, ignore)
		if a.AtLeast("member") {
			pts, trunc, err := s.QueryPoints(f)
			if err != nil { http.Error(w, err.Error(), 500); return }
			writeJSON(w, map[string]any{"points": pts, "truncated": trunc})
			return
		}
		ord, _ := s.HunterOrdinals()
		ps := auth.Pseudonyms(ord)
		f = resolveHunterFilter(f, a, ps)
		own := map[string]bool{}
		for _, c := range a.Companions { own[strings.ToLower(c)] = true }
		var pts []store.Point
		var trunc bool
		switch {
		case f.Hunter != "" && a.ownsCompanion(strings.ToLower(f.Hunter)):
			// filtered to one of the caller's own companions: exact, full history
			p, t, err := s.QueryPoints(f)
			if err != nil { http.Error(w, err.Error(), 500); return }
			pts, trunc = p, t
		case f.Hunter != "":
			// filtered to a specific OTHER hunter: windowed+capped, pseudonymised
			p, t, err := s.QueryPoints(applyGuestWindowCap(f, time.Now()))
			if err != nil { http.Error(w, err.Error(), 500); return }
			pts, trunc = degradePoints(p, ps, nil), t
		default:
			// unfiltered sub-member view: own companions exact+full history,
			// everyone else windowed+capped+pseudonymised (#Important-1, spec §4)
			others, ot, err := s.QueryPoints(applyGuestWindowCap(f, time.Now()))
			if err != nil { http.Error(w, err.Error(), 500); return }
			var rest []store.Point
			for _, p := range others {
				if !own[strings.ToLower(p.HunterPubkey)] { rest = append(rest, p) }
			}
			pseudo := degradePoints(rest, ps, nil)
			var ownRows []store.Point
			ownTrunc := false
			for c := range own {
				of := f
				of.Hunter, of.From, of.Limit = c, "", 0
				rows, t, err := s.QueryPoints(of)
				if err != nil { http.Error(w, err.Error(), 500); return }
				ownRows = append(ownRows, rows...)
				if t { ownTrunc = true }
			}
			pts, trunc = append(ownRows, pseudo...), ot || ownTrunc
		}
		writeJSON(w, map[string]any{"points": pts, "truncated": trunc})
	})
	mux.HandleFunc("/api/heatmap", func(w http.ResponseWriter, r *http.Request) {
		a := AuthOf(r)
		z, _ := strconv.Atoi(r.URL.Query().Get("z"))
		f := filterFrom(r, ignore)
		var ps auth.Pseudonyms
		sub := !a.AtLeast("member")
		if sub {
			ord, _ := s.HunterOrdinals()
			ps = auth.Pseudonyms(ord)
			f = resolveHunterFilter(f, a, ps)
			ownFull := f.Hunter != "" && a.ownsCompanion(strings.ToLower(f.Hunter))
			if !ownFull {
				if z > guestHeatmapMaxZ { z = guestHeatmapMaxZ }
				if f.From == "" || f.From < windowFrom(time.Now()) { f.From = windowFrom(time.Now()) }
			}
		}
		f.Limit = heatmapCap
		pts, trunc, err := s.QueryPoints(f)
		if err != nil { http.Error(w, err.Error(), 500); return }
		if sub {
			own := map[string]bool{}
			for _, c := range a.Companions { own[c] = true }
			pts = degradePoints(pts, ps, own)
		}
		fc := query.Heatmap(pts, geo.ResForZoom(z))
		fc.Truncated = trunc
		writeJSON(w, fc)
	})
	mux.HandleFunc("/api/hunters", func(w http.ResponseWriter, r *http.Request) {
		a := AuthOf(r)
		f := filterFrom(r, ignore)
		hs, err := s.Hunters(f.From, f.To, f.Ignore)
		if err != nil { http.Error(w, err.Error(), 500); return }
		if !a.AtLeast("member") {
			ord, _ := s.HunterOrdinals()
			ps := auth.Pseudonyms(ord)
			own := map[string]bool{}
			for _, c := range a.Companions { own[strings.ToLower(c)] = true }
			hs = pseudonymiseHunters(hs, ps, own)
		}
		writeJSON(w, map[string]any{"hunters": hs})
	})
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"server": version.Version})
	})
	// CoreScope mobile-observer points (extra optional map layers). src selects
	// the layer: advert (zero-hop nodes) or rxlog (last-hop repeaters).
	mux.HandleFunc("/api/observer-points", func(w http.ResponseWriter, r *http.Request) {
		if !AuthOf(r).AtLeast("member") { writeErr(w, 403, "forbidden"); return }
		if cs == nil { // feature disabled (no CoreScope DB configured)
			writeJSON(w, map[string]any{"points": []store.ObserverPoint{}})
			return
		}
		q := r.URL.Query()
		src := q.Get("src")
		hk := q.Get("heard_key")
		if hk == "" && src != "advert" && src != "rxlog" {
			http.Error(w, "src must be advert or rxlog (or provide heard_key)", 400)
			return
		}
		limit := 0
		if n, err := strconv.Atoi(q.Get("limit")); err == nil { limit = n }
		pts, err := cs.ObserverPoints(src, hk, q.Get("from"), q.Get("to"), limit)
		if err != nil { http.Error(w, err.Error(), 500); return }
		writeJSON(w, map[string]any{"points": pts})
	})
	if deps == nil { return }
	if deps.Auth != nil {
		mux.HandleFunc("/api/auth/me", deps.Auth.Me)
		mux.HandleFunc("/api/auth/register", deps.Auth.Register)
		mux.HandleFunc("/api/auth/login", deps.Auth.Login)
		mux.HandleFunc("/api/auth/logout", deps.Auth.Logout)
		mux.HandleFunc("/api/auth/link-companion", deps.Auth.LinkCompanion)
		mux.HandleFunc("/api/auth/reset-request", deps.Auth.ResetRequest)
		mux.HandleFunc("/api/auth/reset", deps.Auth.Reset)
	}
	if deps.Resolve != nil {
		mux.HandleFunc("/api/resolve", deps.Resolve.Resolve)
	}
	if deps.Admin != nil {
		mux.HandleFunc("/api/admin/users", deps.Admin.Users)
		mux.HandleFunc("/api/admin/users/", deps.Admin.UserPatch) // trailing slash → {id}
		mux.HandleFunc("/api/admin/audit", deps.Admin.Audit)
	}
}
