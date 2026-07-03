package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

func newAuthAPI(t *testing.T) (*AuthAPI, *store.Store) {
	st, _ := store.Open(":memory:")
	return &AuthAPI{Store: st, CookieSecure: false, Limiter: auth.NewRateLimiter(5, time.Minute)}, st
}

func TestRegisterThenMe(t *testing.T) {
	h, st := newAuthAPI(t)
	defer st.Close()
	body := `{"username":"alice","password":"correcthorse","companion_pubkey":"aa11"}`
	w := httptest.NewRecorder()
	h.Register(w, httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("register code %d body %s", w.Code, w.Body)
	}
	ck := w.Result().Cookies()
	if len(ck) == 0 || ck[0].Name != CookieName {
		t.Fatal("register must set ch_session cookie")
	}
	// pubkey linked, role hunter
	uid, _ := st.UserIDForCompanion("aa11")
	if uid == 0 {
		t.Fatal("companion not linked on register")
	}
	// short password rejected
	w2 := httptest.NewRecorder()
	h.Register(w2, httptest.NewRequest("POST", "/api/auth/register",
		strings.NewReader(`{"username":"bob","password":"short","companion_pubkey":"bb"}`)))
	if w2.Code != 400 {
		t.Fatalf("short password should be 400, got %d", w2.Code)
	}
	// duplicate username
	w3 := httptest.NewRecorder()
	h.Register(w3, httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(body)))
	if w3.Code != 409 {
		t.Fatalf("dup username should be 409, got %d", w3.Code)
	}
}

func TestLoginLogout(t *testing.T) {
	h, st := newAuthAPI(t)
	defer st.Close()
	hash, _ := auth.HashPassword("correcthorse")
	uid, _ := st.CreateUser("alice", "", hash, "hunter", "active")
	_ = uid
	// good login
	w := httptest.NewRecorder()
	h.Login(w, httptest.NewRequest("POST", "/api/auth/login",
		strings.NewReader(`{"username":"alice","password":"correcthorse","remember":true}`)))
	if w.Code != 200 || len(w.Result().Cookies()) == 0 {
		t.Fatalf("login failed: %d %s", w.Code, w.Body)
	}
	rememberCk := w.Result().Cookies()[0]
	if rememberCk.MaxAge != 2592000 {
		t.Fatalf("remember cookie should have 30d MaxAge, got %d", rememberCk.MaxAge)
	}
	// bad password
	w2 := httptest.NewRecorder()
	h.Login(w2, httptest.NewRequest("POST", "/api/auth/login",
		strings.NewReader(`{"username":"alice","password":"nope"}`)))
	if w2.Code != 401 {
		t.Fatalf("bad password should be 401, got %d", w2.Code)
	}
	// disabled
	st.SetRoleStatus(uid, "hunter", "disabled")
	w3 := httptest.NewRecorder()
	h.Login(w3, httptest.NewRequest("POST", "/api/auth/login",
		strings.NewReader(`{"username":"alice","password":"correcthorse"}`)))
	if w3.Code != 403 {
		t.Fatalf("disabled should be 403, got %d", w3.Code)
	}
}
