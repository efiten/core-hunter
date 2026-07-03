package mail

import "testing"

func TestBuildMessages(t *testing.T) {
	sp := BuildSetPassword("https://map.mesh-hunter.eu", "TOK123")
	if sp.Subject == "" || !containsAll(sp.Body,
		"https://map.mesh-hunter.eu/reset.html?token=TOK123") {
		t.Fatalf("set-password body wrong: %q", sp.Body)
	}
	rs := BuildReset("https://map.mesh-hunter.eu", "TOK9")
	if !containsAll(rs.Body, "https://map.mesh-hunter.eu/reset.html?token=TOK9") {
		t.Fatalf("reset body wrong: %q", rs.Body)
	}
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		found := false
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
