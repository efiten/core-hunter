package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

func TestAtLeast(t *testing.T) {
	cases := []struct {
		have, need string
		ok         bool
	}{
		{"guest", "hunter", false},
		{"hunter", "hunter", true},
		{"hunter", "member", false},
		{"member", "hunter", true},
		{"admin", "member", true},
		{"admin", "admin", true},
	}
	for _, c := range cases {
		if got := (Auth{Role: c.have}).AtLeast(c.need); got != c.ok {
			t.Fatalf("%s AtLeast %s = %v want %v", c.have, c.need, got, c.ok)
		}
	}
}

func TestResolveAuth(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("alice", "", "h", "member", "active")
	st.LinkCompanion(uid, "aa11")
	tok, _ := auth.NewSessionToken()
	st.CreateSession(auth.HashToken(tok), uid, false, "2099-01-01T00:00:00Z", "1.2.3.4")

	r := httptest.NewRequest("GET", "/api/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: CookieName, Value: tok})
	a, _ := ResolveAuth(st, r, time.Now())
	if a.Role != "member" || a.Username != "alice" || len(a.Companions) != 1 {
		t.Fatalf("resolved auth wrong: %+v", a)
	}

	// no cookie -> guest
	r2 := httptest.NewRequest("GET", "/api/auth/me", nil)
	if g, _ := ResolveAuth(st, r2, time.Now()); g.Role != "guest" {
		t.Fatalf("no cookie should be guest, got %+v", g)
	}

	// disabled user -> guest even with a valid session
	st.SetRoleStatus(uid, "member", "disabled")
	if d, _ := ResolveAuth(st, r, time.Now()); d.Role != "guest" {
		t.Fatalf("disabled user must resolve to guest, got %+v", d)
	}
}
