package config

import (
	"os"
	"strings"
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
		`"resolveUpstreams":["https://a/resolve","https://b/resolve"],` +
		`"nodePositionUpstreams":["https://a/positions","https://b/positions"]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.CookieSecure || c.BaseURL != "https://map.mesh-hunter.eu" || c.BrevoSmtpPort != 587 ||
		c.BootstrapAdmin != "efite" || len(c.ResolveUpstreams) != 2 || len(c.NodePositionUpstreams) != 2 {
		t.Fatalf("fields not parsed: %+v", c)
	}
}

func writeCfg(t *testing.T, body string) string {
	t.Helper()
	path := t.TempDir() + "/c.json"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}

func TestLoadReadsExtraBrokers(t *testing.T) {
	c, err := Load(writeCfg(t, `{"mqttUrl":"x","extraBrokers":[{"id":"dmc","url":"tcp://h:1883","username":"u","password":"p","topics":["a/+/obs","b/+/obs"],"format":"wardrive"}]}`))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(c.ExtraBrokers) != 1 {
		t.Fatalf("want 1 broker, got %+v", c.ExtraBrokers)
	}
	b := c.ExtraBrokers[0]
	if b.ID != "dmc" || b.URL != "tcp://h:1883" || b.Username != "u" || b.Password != "p" ||
		b.Format != "wardrive" || len(b.Topics) != 2 || b.Topics[1] != "b/+/obs" {
		t.Fatalf("broker not read back as given: %+v", b)
	}
}

func TestLoadRefusesABadExtraBroker(t *testing.T) {
	ok := func(id string) string {
		return `{"id":"` + id + `","url":"tcp://h:1883","topics":["a"],"format":"wardrive"}`
	}
	cases := []struct{ name, brokers, want string }{
		{"empty id", `[{"id":"","url":"tcp://h","topics":["a"],"format":"wardrive"}]`, "extraBrokers[0] ()"},
		{"id site", `[` + ok("site") + `]`, "extraBrokers[0] (site)"},
		{"duplicate id", `[` + ok("dmc") + `,` + ok("dmc") + `]`, "extraBrokers[1] (dmc)"},
		{"bad format", `[{"id":"dmc","url":"tcp://h","topics":["a"],"format":"hunter"}]`, "extraBrokers[0] (dmc)"},
		{"empty url", `[{"id":"dmc","url":"","topics":["a"],"format":"wardrive"}]`, "extraBrokers[0] (dmc)"},
		{"empty topics", `[{"id":"dmc","url":"tcp://h","topics":[],"format":"wardrive"}]`, "extraBrokers[0] (dmc)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeCfg(t, `{"mqttUrl":"x","extraBrokers":`+tc.brokers+`}`))
			if err == nil {
				t.Fatalf("want an error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not contain %q", err, tc.want)
			}
		})
	}
}

func TestLoadWithoutExtraBrokers(t *testing.T) {
	c, err := Load("testdata/min.json")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.ExtraBrokers != nil {
		t.Fatalf("want nil, got %+v", c.ExtraBrokers)
	}
}
