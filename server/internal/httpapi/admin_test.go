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

// #530: both surfaces promise "an admin verifies you as a member afterwards",
// and until this the promise ended at a role change and an audit row. Mail is
// the addition, not the mechanism -- an address is optional at registration, so
// most accounts have none -- which is exactly why the no-address case below is
// pinned as hard as the sending one.
func TestMemberVerifiedMail(t *testing.T) {
	for _, tc := range []struct {
		name              string
		email, from, to   string
		want              bool
		why               string
	}{
		{"hunter verified as member", "u@example.test", "hunter", "member", true,
			"the case the whole thing exists for"},
		{"straight to admin", "u@example.test", "hunter", "admin", true,
			"admin is above the member line, so the access opened just the same"},
		{"member promoted to admin", "u@example.test", "member", "admin", false,
			"they could already see everything; this is not the news being promised"},
		{"guest to hunter", "u@example.test", "guest", "hunter", false,
			"below the member line: nothing was unlocked to announce"},
		{"member demoted", "u@example.test", "member", "hunter", false,
			"a demotion is the admin's to explain, not a mail's"},
		{"no role change at all", "u@example.test", "member", "member", false,
			"an unrelated status edit must not re-send, or people learn to ignore it"},
		{"no address on file", "", "hunter", "member", false,
			"most accounts, and the reason the map has to tell them itself"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st, _ := store.Open(":memory:")
			defer st.Close()
			fm := &fakeMailer{}
			h := &AdminAPI{Store: st, Mailer: fm}
			aid, _ := st.CreateUser("root", "", "h", "admin", "active")
			uid, _ := st.CreateUser("u", tc.email, "h", tc.from, "active")
			admin := Auth{Role: "admin", UserID: aid, Username: "root"}

			w := httptest.NewRecorder()
			h.UserPatch(w, adminReq("PATCH", "/api/admin/users/"+itoa(uid), `{"role":"`+tc.to+`"}`, admin))
			if w.Code != 204 {
				t.Fatalf("patch failed: %d", w.Code)
			}
			sent := fm.kind == "verified"
			if sent != tc.want {
				t.Fatalf("%s: sent=%v want=%v (%s)", tc.name, sent, tc.want, tc.why)
			}
			if tc.want && fm.lastTo != tc.email {
				t.Fatalf("sent to %q, want %q", fm.lastTo, tc.email)
			}
		})
	}
}

// The role still has to change even with no mailer wired: the map's own notice
// is what most people see, and it reads the role, not the mail.
func TestMemberVerifiedWithoutAMailer(t *testing.T) {
	st, _ := store.Open(":memory:")
	defer st.Close()
	h := &AdminAPI{Store: st}
	aid, _ := st.CreateUser("root", "", "h", "admin", "active")
	uid, _ := st.CreateUser("u", "u@example.test", "h", "hunter", "active")
	w := httptest.NewRecorder()
	h.UserPatch(w, adminReq("PATCH", "/api/admin/users/"+itoa(uid), `{"role":"member"}`,
		Auth{Role: "admin", UserID: aid, Username: "root"}))
	if w.Code != 204 {
		t.Fatalf("patch failed: %d", w.Code)
	}
	u, _ := st.UserByID(uid)
	if u.Role != "member" {
		t.Fatalf("role not changed: %q", u.Role)
	}
}
