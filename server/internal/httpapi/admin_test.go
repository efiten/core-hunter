package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/efiten/core-hunter/server/internal/auth"
	"github.com/efiten/core-hunter/server/internal/store"
)

func adminReq(method, path, body string, a Auth) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	return r.WithContext(context.WithValue(r.Context(), authCtxKey, a))
}

func TestAdminGuard(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	h := &AdminAPI{Store: st}
	w := httptest.NewRecorder()
	h.Users(w, adminReq("GET", "/api/admin/users", "", Auth{Role: "member"}))
	if w.Code != 403 {
		t.Fatalf("non-admin should be 403, got %d", w.Code)
	}
}

func TestAdminListAndInvite(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	fm := &fakeMailer{}
	h := &AdminAPI{Store: st, Mailer: fm, BaseURL: "https://map.mesh-hunter.eu"}
	admin := Auth{Role: "admin", UserID: 1, Username: "root"}
	st.CreateUser("root", "", "h", "admin", "active")

	// invite
	w := httptest.NewRecorder()
	h.Users(w, adminReq("POST", "/api/admin/users",
		`{"username":"carol","email":"c@x.eu","role":"member"}`, admin))
	if w.Code != 200 {
		t.Fatalf("invite should be 200, got %d %s", w.Code, w.Body)
	}
	if fm.kind != "set" || fm.lastTo != "c@x.eu" {
		t.Fatalf("invite must send set-password mail: %+v", fm)
	}
	u, _ := st.UserByUsername("carol")
	if u == nil || u.Status != "pending" {
		t.Fatalf("invited user should be pending: %+v", u)
	}

	// list
	wl := httptest.NewRecorder()
	h.Users(wl, adminReq("GET", "/api/admin/users", "", admin))
	var out map[string]any
	json.Unmarshal(wl.Body.Bytes(), &out)
	if len(out["users"].([]any)) != 2 {
		t.Fatalf("expected 2 users, got %v", out["users"])
	}
}

func TestAdminLastAdminGuard(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	h := &AdminAPI{Store: st}
	id, _ := st.CreateUser("root", "", "h", "admin", "active")
	admin := Auth{Role: "admin", UserID: id, Username: "root"}
	// demoting the only admin must fail
	w := httptest.NewRecorder()
	r := adminReq("PATCH", "/api/admin/users/"+itoa(id), `{"role":"member"}`, admin)
	h.UserPatch(w, r)
	if w.Code != 409 {
		t.Fatalf("last-admin demotion should be 409, got %d", w.Code)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// TestInviteResetActivatesPendingAccount: an admin invite creates a
// set_password token; consuming it via /api/auth/reset sets the password
// AND flips the invited account pending -> active.
func TestInviteResetActivatesPendingAccount(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	fm := &fakeMailer{}
	ah := &AdminAPI{Store: st, Mailer: fm, BaseURL: "https://map.mesh-hunter.eu"}
	admin := Auth{Role: "admin", UserID: 1, Username: "root"}
	st.CreateUser("root", "", "h", "admin", "active")

	w := httptest.NewRecorder()
	ah.Users(w, adminReq("POST", "/api/admin/users",
		`{"username":"dave","email":"d@x.eu","role":"member"}`, admin))
	if w.Code != 200 {
		t.Fatalf("invite should be 200, got %d %s", w.Code, w.Body)
	}
	if fm.kind != "set" || fm.lastToken == "" {
		t.Fatalf("invite must send set-password mail: %+v", fm)
	}
	u, _ := st.UserByUsername("dave")
	if u == nil || u.Status != "pending" {
		t.Fatalf("invited user should be pending: %+v", u)
	}

	authH := &AuthAPI{Store: st}
	wr := httptest.NewRecorder()
	authH.Reset(wr, httptest.NewRequest("POST", "/api/auth/reset",
		strings.NewReader(`{"token":"`+fm.lastToken+`","new_password":"brandnewpass"}`)))
	if wr.Code != 204 {
		t.Fatalf("reset should be 204, got %d %s", wr.Code, wr.Body)
	}
	u2, _ := st.UserByUsername("dave")
	if u2.Status != "active" {
		t.Fatalf("set_password token consume should activate pending user, got status=%s", u2.Status)
	}
	if u2.PasswordHash == "" {
		t.Fatal("password not set by reset")
	}
}

// TestResetPurposeTokenDoesNotActivatePending: a reset-purpose token consumed
// for a still-pending account sets the password but must NOT activate it.
func TestResetPurposeTokenDoesNotActivatePending(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("erin", "e@x.eu", "", "member", "pending")
	raw, hash, err := newResetToken()
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	if err := st.CreateToken(hash, uid, "reset", exp); err != nil {
		t.Fatal(err)
	}

	authH := &AuthAPI{Store: st}
	wr := httptest.NewRecorder()
	authH.Reset(wr, httptest.NewRequest("POST", "/api/auth/reset",
		strings.NewReader(`{"token":"`+raw+`","new_password":"brandnewpass"}`)))
	if wr.Code != 204 {
		t.Fatalf("reset should be 204, got %d %s", wr.Code, wr.Body)
	}
	u, _ := st.UserByID(uid)
	if u.Status != "pending" {
		t.Fatalf("reset-purpose token must NOT activate a pending account, got status=%s", u.Status)
	}
	if !auth.CheckPassword(u.PasswordHash, "brandnewpass") {
		t.Fatal("password not changed by reset")
	}
}
