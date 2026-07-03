package httpapi

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

// Mailer sends account emails (set-password invites and password resets).
type Mailer interface {
	SendSetPassword(to, token string) error
	SendReset(to, token string) error
}

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

// AuthAPI holds the dependencies for the auth HTTP handlers.
type AuthAPI struct {
	Store        *store.Store
	CookieSecure bool
	Limiter      *auth.RateLimiter
	Mailer       Mailer
	BaseURL      string
}

func writeErr(w http.ResponseWriter, code int, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": reason})
}

func writeMe(w http.ResponseWriter, a Auth) {
	w.Header().Set("Content-Type", "application/json")
	if a.Role == "guest" {
		json.NewEncoder(w).Encode(map[string]any{"role": "guest"})
		return
	}
	comps := a.Companions
	if comps == nil {
		comps = []string{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"username": a.Username, "role": a.Role, "companions": comps,
	})
}

func (h *AuthAPI) Me(w http.ResponseWriter, r *http.Request) { writeMe(w, AuthOf(r)) }

func (h *AuthAPI) startSession(w http.ResponseWriter, userID int64, remember bool, ip string) error {
	tok, err := auth.NewSessionToken()
	if err != nil {
		return err
	}
	exp := time.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if !remember {
		exp = time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	}
	if err := h.Store.CreateSession(auth.HashToken(tok), userID, remember, exp, ip); err != nil {
		return err
	}
	http.SetCookie(w, sessionCookie(tok, remember, h.CookieSecure))
	return nil
}

func (h *AuthAPI) authForUser(userID int64) Auth {
	u, err := h.Store.UserByID(userID)
	if err != nil || u == nil {
		return Guest()
	}
	comps, _ := h.Store.CompanionsFor(u.ID)
	return Auth{UserID: u.ID, Username: u.Username, Role: u.Role, Companions: comps}
}

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

func (h *AuthAPI) Register(w http.ResponseWriter, r *http.Request) {
	if !h.Limiter.Allow(clientIP(r), time.Now()) {
		writeErr(w, 429, "rate_limited")
		return
	}
	var in struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		Email           string `json:"email"`
		CompanionPubkey string `json:"companion_pubkey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad_json")
		return
	}
	if !usernameRe.MatchString(in.Username) {
		writeErr(w, 400, "username_invalid")
		return
	}
	if !auth.ValidPassword(in.Password) {
		writeErr(w, 400, "password_too_short")
		return
	}
	if in.CompanionPubkey == "" {
		writeErr(w, 400, "companion_required")
		return
	}
	if u, _ := h.Store.UserByUsername(in.Username); u != nil {
		writeErr(w, 409, "username_taken")
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		writeErr(w, 500, "hash_error")
		return
	}
	uid, err := h.Store.CreateUser(in.Username, in.Email, hash, "hunter", "active")
	if err != nil {
		writeErr(w, 409, "username_taken")
		return
	}
	h.Store.LinkCompanion(uid, strings.ToLower(in.CompanionPubkey))
	if err := h.startSession(w, uid, true, clientIP(r)); err != nil {
		writeErr(w, 500, "session_error")
		return
	}
	h.Store.AddAudit(uid, "register", in.Username, clientIP(r), "")
	writeMe(w, h.authForUser(uid))
}

func (h *AuthAPI) Login(w http.ResponseWriter, r *http.Request) {
	if !h.Limiter.Allow(clientIP(r), time.Now()) {
		writeErr(w, 429, "rate_limited")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad_json")
		return
	}
	ip := clientIP(r)
	u, _ := h.Store.UserByUsername(in.Username)
	if u == nil || !auth.CheckPassword(u.PasswordHash, in.Password) {
		h.Store.AddAudit(0, "login_fail", in.Username, ip, "")
		writeErr(w, 401, "bad_credentials")
		return
	}
	if u.Status != "active" {
		h.Store.AddAudit(u.ID, "login_fail", in.Username, ip, "disabled")
		writeErr(w, 403, "disabled")
		return
	}
	if err := h.startSession(w, u.ID, in.Remember, ip); err != nil {
		writeErr(w, 500, "session_error")
		return
	}
	h.Store.SetLastLogin(u.ID, time.Now().UTC().Format(time.RFC3339))
	h.Store.AddAudit(u.ID, "login_ok", in.Username, ip, "")
	writeMe(w, h.authForUser(u.ID))
}

func (h *AuthAPI) LinkCompanion(w http.ResponseWriter, r *http.Request) {
	a := AuthOf(r)
	if a.UserID == 0 {
		writeErr(w, 401, "unauthenticated")
		return
	}
	var in struct {
		CompanionPubkey string `json:"companion_pubkey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CompanionPubkey == "" {
		writeErr(w, 400, "companion_required")
		return
	}
	pk := strings.ToLower(in.CompanionPubkey)
	if err := h.Store.LinkCompanion(a.UserID, pk); err != nil {
		writeErr(w, 500, "link_error")
		return
	}
	h.Store.AddAudit(a.UserID, "link_companion", pk, clientIP(r), "")
	writeMe(w, h.authForUser(a.UserID))
}

func newResetToken() (raw, hash string, err error) {
	raw, err = auth.NewSessionToken()
	if err != nil {
		return "", "", err
	}
	return raw, auth.HashToken(raw), nil
}

func (h *AuthAPI) ResetRequest(w http.ResponseWriter, r *http.Request) {
	if !h.Limiter.Allow(clientIP(r), time.Now()) {
		writeErr(w, 429, "rate_limited")
		return
	}
	var in struct {
		Identifier string `json:"identifier"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	// resolve by username or email
	u, _ := h.Store.UserByUsername(in.Identifier)
	if u == nil {
		u, _ = h.Store.UserByEmail(in.Identifier)
	}
	if u != nil && u.Email != "" && h.Mailer != nil {
		raw, hash, err := newResetToken()
		if err == nil {
			exp := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
			if h.Store.CreateToken(hash, u.ID, "reset", exp) == nil {
				h.Mailer.SendReset(u.Email, raw)
				h.Store.AddAudit(u.ID, "reset_request", u.Username, clientIP(r), "")
			}
		}
	}
	w.WriteHeader(204) // always, to avoid user enumeration
}

func (h *AuthAPI) Reset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid_token")
		return
	}
	if !auth.ValidPassword(in.NewPassword) {
		writeErr(w, 400, "password_too_short")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	hash := auth.HashToken(in.Token)
	// accept either purpose (reset OR set_password) on the same consume path
	tok, _ := h.Store.ConsumeToken(hash, "reset", now, now)
	if tok == nil {
		tok, _ = h.Store.ConsumeToken(hash, "set_password", now, now)
	}
	if tok == nil {
		writeErr(w, 400, "invalid_token")
		return
	}
	pwHash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		writeErr(w, 500, "hash_error")
		return
	}
	h.Store.SetPassword(tok.UserID, pwHash)
	// only a set_password token activates a pending invited account; a
	// reset-purpose token must never flip status on its own
	if tok.Purpose == "set_password" {
		if u, _ := h.Store.UserByID(tok.UserID); u != nil && u.Status == "pending" {
			h.Store.SetRoleStatus(u.ID, u.Role, "active")
		}
	}
	h.Store.AddAudit(tok.UserID, "password_reset", "", clientIP(r), "")
	w.WriteHeader(204)
}

func (h *AuthAPI) Logout(w http.ResponseWriter, r *http.Request) {
	if ck, err := r.Cookie(CookieName); err == nil && ck.Value != "" {
		h.Store.DeleteSession(auth.HashToken(ck.Value))
	}
	a := AuthOf(r)
	if a.UserID != 0 {
		h.Store.AddAudit(a.UserID, "logout", a.Username, clientIP(r), "")
	}
	http.SetCookie(w, clearCookie(h.CookieSecure))
	w.WriteHeader(204)
}
