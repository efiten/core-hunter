package httpapi

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

const CookieName = "ch_session"

type Auth struct {
	UserID     int64
	Username   string
	Role       string
	Companions []string
}

var roleRank = map[string]int{"guest": 0, "hunter": 1, "member": 2, "admin": 3}

func (a Auth) AtLeast(role string) bool { return roleRank[a.Role] >= roleRank[role] }

func Guest() Auth { return Auth{Role: "guest"} }

func (a Auth) ownsCompanion(pubkey string) bool {
	for _, c := range a.Companions {
		if c == pubkey {
			return true
		}
	}
	return false
}

type ctxKey int

const authCtxKey ctxKey = 0

// ResolveAuth reads the ch_session cookie, looks up session+user per request,
// and returns the caller's Auth (Guest on any miss/disabled). It also slides
// a remember-me session's expiry when more than halfway elapsed.
func ResolveAuth(s *store.Store, r *http.Request, now time.Time) (Auth, bool) {
	ck, err := r.Cookie(CookieName)
	if err != nil || ck.Value == "" {
		return Guest(), false
	}
	sess, err := s.SessionByTokenHash(auth.HashToken(ck.Value))
	if err != nil || sess == nil {
		return Guest(), false
	}
	// expiry check (RFC3339 lexical compare is valid for UTC 'Z' timestamps)
	if sess.ExpiresAt <= now.UTC().Format(time.RFC3339) {
		return Guest(), false
	}
	u, err := s.UserByID(sess.UserID)
	if err != nil || u == nil || u.Status != "active" {
		return Guest(), false
	}
	comps, _ := s.CompanionsFor(u.ID)
	refreshed := false
	if sess.Remember {
		// slide when >50% of the 30d window elapsed
		newExp := now.Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339)
		_ = s.TouchSession(sess.TokenHash, newExp)
		refreshed = true
	}
	return Auth{UserID: u.ID, Username: u.Username, Role: u.Role, Companions: comps}, refreshed
}

// WithAuth wraps a handler, storing the resolved Auth in the request context.
func WithAuth(next http.Handler, s *store.Store, cookieSecure bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a, refreshed := ResolveAuth(s, r, time.Now())
		if refreshed {
			// re-send the sliding remember-me cookie with a fresh Max-Age
			if ck, err := r.Cookie(CookieName); err == nil {
				http.SetCookie(w, sessionCookie(ck.Value, true, cookieSecure))
			}
		}
		ctx := context.WithValue(r.Context(), authCtxKey, a)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func AuthOf(r *http.Request) Auth {
	if a, ok := r.Context().Value(authCtxKey).(Auth); ok {
		return a
	}
	return Guest()
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// sessionCookie builds the ch_session Set-Cookie. remember=false => session cookie.
func sessionCookie(value string, remember, secure bool) *http.Cookie {
	c := &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		Domain:   ".mesh-hunter.eu",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
	if remember {
		c.MaxAge = 2592000 // 30 days
	}
	return c
}

func clearCookie(secure bool) *http.Cookie {
	return &http.Cookie{
		Name: CookieName, Value: "", Path: "/", Domain: ".mesh-hunter.eu",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	}
}
