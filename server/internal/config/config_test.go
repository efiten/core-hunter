package config

import (
	"os"
	"testing"
)

func TestLoadDefaultsTopic(t *testing.T) {
	c, err := Load("testdata/min.json")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.MQTTTopic != "meshcore/hunter/+/packets" {
		t.Fatalf("topic = %q, want default wildcard", c.MQTTTopic)
	}
	if c.DBPath == "" || c.HTTPAddr == "" {
		t.Fatalf("DBPath/HTTPAddr must have defaults, got %q / %q", c.DBPath, c.HTTPAddr)
	}
}

func TestLoadAuthDefaults(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/c.json"
	// minimal config: only mqttUrl; everything else defaulted
	if err := os.WriteFile(path, []byte(`{"mqttUrl":"wss://x/ws"}`), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !c.CookieSecure {
		t.Fatalf("CookieSecure should default true, got %v", c.CookieSecure)
	}
}

func TestLoadAuthExplicit(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/c.json"
	body := `{"mqttUrl":"wss://x/ws","cookieSecure":false,"baseUrl":"https://map.mesh-hunter.eu",` +
		`"brevoSmtpHost":"smtp-relay.brevo.com","brevoSmtpPort":587,"brevoUser":"u","brevoApiKey":"k",` +
		`"mailFrom":"no-reply@mesh-hunter.eu","bootstrapAdmin":"efite",` +
		`"resolveUpstreams":["https://a/resolve","https://b/resolve"]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.CookieSecure || c.BaseURL != "https://map.mesh-hunter.eu" || c.BrevoSmtpPort != 587 ||
		c.BootstrapAdmin != "efite" || len(c.ResolveUpstreams) != 2 {
		t.Fatalf("fields not parsed: %+v", c)
	}
}
