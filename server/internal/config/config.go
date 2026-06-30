package config

import (
	"encoding/json"
	"os"
)

type Config struct {
	MQTTURL      string `json:"mqttUrl"`
	MQTTUsername string `json:"mqttUsername"`
	MQTTPassword string `json:"mqttPassword"`
	MQTTTopic    string `json:"mqttTopic"`
	DBPath       string `json:"dbPath"`
	HTTPAddr     string `json:"httpAddr"`
	// Ignore is a server-side default list of sender_ids excluded from all read
	// endpoints (merged with any per-request ?ignore=). Case-insensitive.
	Ignore []string `json:"ignore"`
}

func Load(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if c.MQTTTopic == "" {
		c.MQTTTopic = "meshcore/hunter/+/packets"
	}
	if c.DBPath == "" {
		c.DBPath = "data/hunter.db"
	}
	if c.HTTPAddr == "" {
		c.HTTPAddr = ":8090"
	}
	return c, nil
}
