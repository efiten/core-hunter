package store

import (
	"encoding/json"
	"errors"
)

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
		HunterPubkey: p.OriginID,
		HunterName:   p.Origin,
		RxAt:         p.Timestamp,
		IngestedAt:   ingestedAt,
		SNR:          p.SNR,
		RSSI:         p.RSSI,
		Raw:          p.Raw,
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
	}, nil
}
