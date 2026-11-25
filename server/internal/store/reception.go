package store

import (
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/efiten/core-hunter/server/internal/meshpacket"
)

// SourceSite marks a reception that arrived through our own broker, as opposed
// to a copy read from an extra broker.
const SourceSite = "site"

// ErrNoSignal is returned for an obs without RSSI or SNR. A reception that
// carries no signal strength cannot be drawn on the coverage map, and a value
// type would turn the missing figure into 0 dB, a real reading.
var ErrNoSignal = errors.New("obs has no RSSI or SNR")

// ErrNoPosition is returned for a payload that carries no usable position.
// A reception without one is useless to this product — the hunter app refuses
// to capture without a GPS fix — and a value type would silently turn a
// missing lat/lon into 0,0, a real coordinate in the Gulf of Guinea. Callers
// route it to the dead-letter table like any other parse failure (#346).
var ErrNoPosition = errors.New("payload has no gps lat/lon")

type Reception struct {
	HunterPubkey string
	HunterName   string
	RxAt         string
	IngestedAt   string
	SNR          float64
	RSSI         int
	Raw          string
	PacketType   string
	SenderKey    string
	SenderKeylen int
	SenderRole   string
	SenderKind   string
	SenderID     string
	SenderLabel  string
	ChannelName  string
	IsDirect     bool
	Hops         int
	Lat          float64
	Lon          float64
	// PosAccM is nil when the hunter reported no accuracy figure, so that
	// "unknown" is stored as SQL NULL instead of as 0 — the most accurate
	// value the column can hold (#346).
	PosAccM   *float64
	MQTTTopic string
	// Source is the broker the reception was read from; empty is stored as
	// SourceSite.
	Source string
}

type payload struct {
	OriginID     string  `json:"origin_id"`
	Origin       string  `json:"origin"`
	Timestamp    string  `json:"timestamp"`
	Raw          string  `json:"raw"`
	SNR          float64 `json:"SNR"`
	RSSI         int     `json:"RSSI"`
	IsDirect     bool    `json:"is_direct"`
	Hops         int     `json:"hops"`
	SenderKey    string  `json:"sender_key"`
	SenderKeylen int     `json:"sender_keylen"`
	SenderRole   string  `json:"sender_role"`
	SenderKind   string  `json:"sender_kind"`
	SenderID     string  `json:"sender_id"`
	SenderLabel  string  `json:"sender_label"`
	ChannelName  string  `json:"channel_name"`
	PacketType   string  `json:"packet_type"`
	// Pointers throughout the gps block: encoding/json leaves a value type at
	// its zero value for both a JSON null and an absent key, which is exactly
	// the distinction that matters here (#346).
	GPS *struct {
		Lat  *float64 `json:"lat"`
		Lon  *float64 `json:"lon"`
		AccM *float64 `json:"acc_m"`
	} `json:"gps"`
}

func ParsePayload(topic string, body []byte, ingestedAt string) (Reception, error) {
	var p payload
	if err := json.Unmarshal(body, &p); err != nil {
		return Reception{}, err
	}
	if p.GPS == nil || p.GPS.Lat == nil || p.GPS.Lon == nil {
		return Reception{}, ErrNoPosition
	}
	return Reception{
		HunterPubkey: strings.ToLower(p.OriginID),
		HunterName:   p.Origin,
		RxAt:         p.Timestamp,
		IngestedAt:   ingestedAt,
		SNR:          p.SNR,
		RSSI:         p.RSSI,
		Raw:          strings.ToLower(p.Raw),
		PacketType:   p.PacketType,
		SenderKey:    p.SenderKey,
		SenderKeylen: p.SenderKeylen,
		SenderRole:   p.SenderRole,
		SenderKind:   p.SenderKind,
		SenderID:     p.SenderID,
		SenderLabel:  p.SenderLabel,
		ChannelName:  p.ChannelName,
		IsDirect:     p.IsDirect,
		Hops:         p.Hops,
		Lat:          *p.GPS.Lat,
		Lon:          *p.GPS.Lon,
		PosAccM:      p.GPS.AccM,
		MQTTTopic:    topic,
		Source:       SourceSite,
	}, nil
}

// obs is the message a wardrive publisher sends (app/src/wardrive.js buildObs).
// hash, path, route, packet_type and radio are left out on purpose: they are
// all read off raw, or not stored.
type obs struct {
	OriginID string   `json:"origin_id"`
	RxAt     string   `json:"rx_at"`
	Raw      string   `json:"raw"`
	RSSI     *float64 `json:"RSSI"`
	SNR      *float64 `json:"SNR"`
	Pos      *struct {
		Lat      *float64 `json:"lat"`
		Lon      *float64 `json:"lon"`
		Accuracy *float64 `json:"accuracy"`
	} `json:"pos"`
}

// ParseObs reads a wardrive obs from an extra broker. The origin and the raw
// frame are folded to lower case because the keys of the same reception must
// match whatever case a publisher wrote them in, or the copy through the other
// broker would not collapse into one row. The sender is classified from raw,
// the same way the app does it for a reception of our own.
func ParseObs(topic string, body []byte, ingestedAt, source string) (Reception, error) {
	var o obs
	if err := json.Unmarshal(body, &o); err != nil {
		return Reception{}, err
	}
	if o.Pos == nil || o.Pos.Lat == nil || o.Pos.Lon == nil {
		return Reception{}, ErrNoPosition
	}
	if o.RSSI == nil || o.SNR == nil {
		return Reception{}, ErrNoSignal
	}
	raw := strings.ToLower(o.Raw)
	c := meshpacket.Classify(raw)
	return Reception{
		HunterPubkey: strings.ToLower(o.OriginID),
		RxAt:         o.RxAt,
		IngestedAt:   ingestedAt,
		SNR:          *o.SNR,
		RSSI:         int(math.Round(*o.RSSI)),
		Raw:          raw,
		PacketType:   c.PacketType,
		SenderKind:   c.SenderKind,
		SenderID:     c.SenderID,
		SenderLabel:  c.SenderLabel,
		SenderRole:   c.SenderRole,
		IsDirect:     c.IsDirect,
		Hops:         c.Hops,
		Lat:          *o.Pos.Lat,
		Lon:          *o.Pos.Lon,
		PosAccM:      o.Pos.Accuracy,
		MQTTTopic:    topic,
		Source:       source,
	}, nil
}
