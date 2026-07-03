package auth

import "testing"

func TestNewSessionTokenUniqueAndUrlSafe(t *testing.T) {
	a, err := NewSessionToken()
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	b, _ := NewSessionToken()
	if a == b {
		t.Fatal("tokens must be unique")
	}
	if len(a) < 40 {
		t.Fatalf("token too short: %q", a)
	}
	for _, c := range a {
		if c == '=' || c == '+' || c == '/' {
			t.Fatalf("token not url-safe / has padding: %q", a)
		}
	}
}

func TestHashTokenStable(t *testing.T) {
	if HashToken("abc") != HashToken("abc") {
		t.Fatal("hash must be deterministic")
	}
	if HashToken("abc") == "abc" || len(HashToken("abc")) != 64 {
		t.Fatalf("hash should be 64 hex chars, got %q", HashToken("abc"))
	}
}
