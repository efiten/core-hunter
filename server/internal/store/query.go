package store

import (
	"database/sql"
	"strings"
)

type Filter struct {
	MinLat, MinLon, MaxLat, MaxLon float64
	HasBBox                        bool
	// Sender is a single leading-prefix match on sender_id (the web viewer's
	// free-text field, and the app's isolate). Senders (below) is the exact
	// multi-id variant — they are mutually exclusive; Senders wins if both set.
	From, To, Sender               string
	// Senders filters on an exact set of sender_ids, matching any of them
	// (SQL IN, case-insensitive); empty = no filter (#223). The target-list
	// picker selects whole ids, so prefix semantics would over-match — picking
	// 'aa' must not also return 'aabb'. Mirrors Hunter's shape (#196).
	Senders                        []string
	Ignore                         []string
	// Hunter filters on hunter_pubkey; multiple values match any of them
	// (SQL IN); empty = no filter (#196).
	Hunter []string
	// Hops filters on the exact hop count; nil = no hop filter. Direct-only
	// (zero-hop) is Hops=0 — is_direct is not usable as a query condition, it
	// is also true for relayed last-hop measurements (#138/#142).
	Hops   *int
	// Types filters on packet_type (same values the app uses); empty = all.
	Types  []string
	Limit  int
	Offset int
}

type Point struct {
	Lat          float64  `json:"lat"`
	Lon          float64  `json:"lon"`
	RSSI         *int     `json:"rssi"`
	SNR          *float64 `json:"snr"`
	SenderID     string   `json:"sender_id"`
	SenderLabel  string   `json:"sender_label"`
	SenderKind   string   `json:"sender_kind"`
	SenderRole   string   `json:"sender_role"`
	HunterPubkey string   `json:"hunter_pubkey"`
	HunterName   string   `json:"hunter_name"`
	ChannelName  string   `json:"channel_name"`
	PacketType   string   `json:"packet_type"`
	Hops         int      `json:"hops"`
	RxAt         string   `json:"rx_at"`
}

func (f Filter) where() (string, []any) {
	conds := []string{"1=1"}
	var args []any
	if f.Hops != nil {
		conds = append(conds, "hops = ?"); args = append(args, *f.Hops)
	}
	if len(f.Types) > 0 {
		ph := make([]string, len(f.Types))
		for i, t := range f.Types {
			ph[i] = "?"; args = append(args, t)
		}
		conds = append(conds, "packet_type IN ("+strings.Join(ph, ",")+")")
	}
	if f.HasBBox {
		conds = append(conds, "lat BETWEEN ? AND ?", "lon BETWEEN ? AND ?")
		args = append(args, f.MinLat, f.MaxLat, f.MinLon, f.MaxLon)
	}
	if f.From != "" {
		conds = append(conds, "rx_at >= ?"); args = append(args, f.From)
	}
	if f.To != "" {
		conds = append(conds, "rx_at <= ?"); args = append(args, f.To)
	}
	if len(f.Hunter) > 0 {
		ph := make([]string, len(f.Hunter))
		for i, h := range f.Hunter {
			ph[i] = "?"; args = append(args, h)
		}
		conds = append(conds, "hunter_pubkey IN ("+strings.Join(ph, ",")+")")
	}
	if len(f.Senders) > 0 {
		ph := make([]string, len(f.Senders))
		for i, s := range f.Senders {
			ph[i] = "?"; args = append(args, strings.ToLower(s))
		}
		conds = append(conds, "sender_id IS NOT NULL AND lower(sender_id) IN ("+strings.Join(ph, ",")+")")
	} else if f.Sender != "" {
		conds = append(conds, "sender_id IS NOT NULL AND lower(sender_id) LIKE ?"); args = append(args, strings.ToLower(f.Sender)+"%")
	}
	conds, args = ignoreCond(conds, args, f.Ignore)
	return strings.Join(conds, " AND "), args
}

// ignoreCond appends the server-side ignore-list exclusion (case-insensitive
// sender_id) to a WHERE accumulator. Shared by QueryPoints and Hunters so every
// read endpoint excludes the same senders.
func ignoreCond(conds []string, args []any, ignore []string) ([]string, []any) {
	if len(ignore) == 0 {
		return conds, args
	}
	ph := make([]string, len(ignore))
	for i, s := range ignore {
		ph[i] = "?"
		args = append(args, strings.ToLower(s))
	}
	return append(conds, "(sender_id IS NULL OR lower(sender_id) NOT IN ("+strings.Join(ph, ",")+"))"), args
}

// QueryPoints returns rows matching f, newest first, capped at f.Limit
// (default 5000), skipping f.Offset rows for paging. truncated is true when
// more rows matched beyond the returned page. Direct-only is an explicit
// f.Hops=0 filter, not an implicit condition.
func (s *Store) QueryPoints(f Filter) (out []Point, truncated bool, err error) {
	if f.Limit <= 0 { f.Limit = 5000 }
	if f.Offset < 0 { f.Offset = 0 }
	w, args := f.where()
	args = append(args, f.Limit+1, f.Offset) // fetch one extra to detect truncation precisely
	rows, err := s.db.Query(`SELECT lat,lon,rssi,snr,sender_id,sender_label,sender_kind,sender_role,hunter_pubkey,hunter_name,channel_name,packet_type,hops,rx_at
		FROM hunter_receptions WHERE `+w+` ORDER BY rx_at DESC LIMIT ? OFFSET ?`, args...)
	if err != nil { return nil, false, err }
	defer rows.Close()
	for rows.Next() {
		var p Point
		var rssi sql.NullInt64
		var snr sql.NullFloat64
		var sid, slabel, skind, srole, cn sql.NullString
		if err := rows.Scan(&p.Lat, &p.Lon, &rssi, &snr, &sid, &slabel, &skind, &srole, &p.HunterPubkey, &p.HunterName, &cn, &p.PacketType, &p.Hops, &p.RxAt); err != nil {
			return nil, false, err
		}
		if rssi.Valid { v := int(rssi.Int64); p.RSSI = &v }
		if snr.Valid { p.SNR = &snr.Float64 }
		p.SenderID, p.SenderLabel, p.SenderKind, p.SenderRole, p.ChannelName = sid.String, slabel.String, skind.String, srole.String, cn.String
		out = append(out, p)
	}
	if err := rows.Err(); err != nil { return nil, false, err }
	if len(out) > f.Limit {
		out, truncated = out[:f.Limit], true
	}
	return out, truncated, nil
}

type Hunter struct {
	Pubkey string `json:"hunter_pubkey"`
	Name   string `json:"hunter_name"`
	Count  int    `json:"count"`
}

func (s *Store) Hunters(from, to string, ignore []string) ([]Hunter, error) {
	conds := []string{"1=1"}
	var args []any
	if from != "" { conds = append(conds, "rx_at >= ?"); args = append(args, from) }
	if to != "" { conds = append(conds, "rx_at <= ?"); args = append(args, to) }
	conds, args = ignoreCond(conds, args, ignore)
	rows, err := s.db.Query(`SELECT hunter_pubkey, max(hunter_name), count(*) FROM hunter_receptions WHERE `+strings.Join(conds, " AND ")+` GROUP BY hunter_pubkey ORDER BY 3 DESC`, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Hunter
	for rows.Next() {
		var h Hunter
		if err := rows.Scan(&h.Pubkey, &h.Name, &h.Count); err != nil { return nil, err }
		out = append(out, h)
	}
	return out, rows.Err()
}

// HunterOrdinals ranks each hunter_pubkey by first appearance (MIN(rx_at) asc)
// and returns a 1-based ordinal per pubkey. Deterministic and stable.
func (s *Store) HunterOrdinals() (map[string]int, error) {
	rows, err := s.db.Query(
		`SELECT hunter_pubkey FROM hunter_receptions
		 GROUP BY hunter_pubkey ORDER BY MIN(rx_at) ASC, hunter_pubkey ASC`)
	if err != nil { return nil, err }
	defer rows.Close()
	out := map[string]int{}
	n := 0
	for rows.Next() {
		var pk string
		if err := rows.Scan(&pk); err != nil { return nil, err }
		n++
		out[pk] = n
	}
	return out, rows.Err()
}
