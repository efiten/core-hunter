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
	// CSDBPath is the read-only path to the CoreScope meshcore.db (mounted into
	// the container). Empty disables the /api/observer-points endpoint.
	CSDBPath string `json:"csDbPath"`
	// Ignore is a server-side default list of sender_ids excluded from all read
	// endpoints (merged with any per-request ?ignore=). Case-insensitive.
	Ignore []string `json:"ignore"`

	// --- user management (v1.0) ---
	CookieSecure     bool     `json:"cookieSecure"` // default true (see Load)
	BaseURL          string   `json:"baseUrl"`      // e.g. https://map.mesh-hunter.eu, for mail links
	BrevoSmtpHost    string   `json:"brevoSmtpHost"`
	BrevoSmtpPort    int      `json:"brevoSmtpPort"`
	BrevoUser        string   `json:"brevoUser"`
	BrevoApiKey      string   `json:"brevoApiKey"`
	MailFrom         string   `json:"mailFrom"`
	BootstrapAdmin   string   `json:"bootstrapAdmin"`   // username promoted to admin on startup if it exists
	ResolveUpstreams []string `json:"resolveUpstreams"` // SF7/SF8 resolve URLs proxied by /api/resolve
}

func Load(path string) (Config, error) {
	c := Config{CookieSecure: true} // default; explicit "cookieSecure":false overrides
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
