package store

import "testing"

func TestAuthTablesExist(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	for _, tbl := range []string{"users", "companions", "sessions", "tokens", "audit_log"} {
		var name string
		err := st.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&name)
		if err != nil {
			t.Fatalf("table %s missing: %v", tbl, err)
		}
	}
}

func TestUserCRUD(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	id, err := st.CreateUser("alice", "a@x.eu", "hash1", "hunter", "active")
	if err != nil || id == 0 {
		t.Fatalf("create: %v id=%d", err, id)
	}
	if _, err := st.CreateUser("alice", "", "h", "hunter", "active"); err == nil {
		t.Fatal("duplicate username should fail (UNIQUE)")
	}
	u, err := st.UserByUsername("alice")
	if err != nil || u == nil || u.Email != "a@x.eu" || u.Role != "hunter" {
		t.Fatalf("byusername: %v %+v", err, u)
	}
	if got, _ := st.UserByUsername("nobody"); got != nil {
		t.Fatalf("absent user should be nil, got %+v", got)
	}
	if err := st.SetRoleStatus(id, "member", "disabled"); err != nil {
		t.Fatalf("setrolestatus: %v", err)
	}
	u2, _ := st.UserByID(id)
	if u2.Role != "member" || u2.Status != "disabled" {
		t.Fatalf("role/status not updated: %+v", u2)
	}
	if err := st.SetPassword(id, "hash2"); err != nil {
		t.Fatalf("setpassword: %v", err)
	}
	u3, _ := st.UserByID(id)
	if u3.PasswordHash != "hash2" {
		t.Fatalf("password not updated: %+v", u3)
	}
	list, _ := st.ListUsers()
	if len(list) != 1 {
		t.Fatalf("listusers want 1 got %d", len(list))
	}
}

func TestCountActiveAdmins(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	a, _ := st.CreateUser("root", "", "h", "admin", "active")
	st.CreateUser("m", "", "h", "member", "active")
	if n, _ := st.CountActiveAdmins(); n != 1 {
		t.Fatalf("want 1 admin got %d", n)
	}
	st.SetRoleStatus(a, "admin", "disabled")
	if n, _ := st.CountActiveAdmins(); n != 0 {
		t.Fatalf("want 0 active admins got %d", n)
	}
}

func TestCompanions(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("alice", "", "h", "hunter", "active")
	if err := st.LinkCompanion(uid, "aa11"); err != nil {
		t.Fatalf("link: %v", err)
	}
	st.LinkCompanion(uid, "aa11") // idempotent
	st.LinkCompanion(uid, "bb22")
	cs, _ := st.CompanionsFor(uid)
	if len(cs) != 2 {
		t.Fatalf("want 2 companions got %v", cs)
	}
	if got, _ := st.UserIDForCompanion("aa11"); got != uid {
		t.Fatalf("owner lookup wrong: %d", got)
	}
	if got, _ := st.UserIDForCompanion("zz99"); got != 0 {
		t.Fatalf("unlinked should be 0 got %d", got)
	}
}

func TestSessions(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("alice", "", "h", "hunter", "active")
	st.CreateSession("th1", uid, true, "2026-08-01T00:00:00Z", "1.2.3.4")
	sess, _ := st.SessionByTokenHash("th1")
	if sess == nil || sess.UserID != uid || !sess.Remember {
		t.Fatalf("session lookup: %+v", sess)
	}
	st.TouchSession("th1", "2026-09-01T00:00:00Z")
	sess, _ = st.SessionByTokenHash("th1")
	if sess.ExpiresAt != "2026-09-01T00:00:00Z" {
		t.Fatalf("touch failed: %+v", sess)
	}
	st.DeleteSession("th1")
	if got, _ := st.SessionByTokenHash("th1"); got != nil {
		t.Fatalf("session should be gone: %+v", got)
	}
}

func TestTokensConsumeOnce(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("alice", "a@x.eu", "h", "hunter", "active")
	st.CreateToken("tk1", uid, "reset", "2026-08-01T00:00:00Z")
	now := "2026-07-10T00:00:00Z"
	tok, _ := st.ConsumeToken("tk1", "reset", now, now)
	if tok == nil || tok.UserID != uid {
		t.Fatalf("first consume should work: %+v", tok)
	}
	if again, _ := st.ConsumeToken("tk1", "reset", now, now); again != nil {
		t.Fatal("second consume must fail (already used)")
	}
	st.CreateToken("tk2", uid, "reset", "2026-07-05T00:00:00Z") // already expired vs now
	if exp, _ := st.ConsumeToken("tk2", "reset", now, now); exp != nil {
		t.Fatal("expired token must not consume")
	}
	st.CreateToken("tk3", uid, "set_password", "2026-08-01T00:00:00Z")
	if wrong, _ := st.ConsumeToken("tk3", "reset", now, now); wrong != nil {
		t.Fatal("purpose mismatch must not consume")
	}
}

func TestBootstrapAdminPromotion(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	id, _ := st.CreateUser("efite", "", "h", "hunter", "active")
	// simulate the main.go bootstrap: promote existing user to admin
	u, _ := st.UserByUsername("efite")
	if u == nil {
		t.Fatal("user missing")
	}
	st.SetRoleStatus(u.ID, "admin", "active")
	got, _ := st.UserByID(id)
	if got.Role != "admin" {
		t.Fatalf("bootstrap promotion failed: %+v", got)
	}
}

func TestAudit(t *testing.T) {
	st, _ := Open(":memory:")
	defer st.Close()
	uid, _ := st.CreateUser("root", "", "h", "admin", "active")
	st.AddAudit(uid, "login_ok", "root", "1.2.3.4", "")
	st.AddAudit(0, "login_fail", "ghost", "9.9.9.9", "bad password")
	ev, _ := st.ListAudit(10)
	if len(ev) != 2 {
		t.Fatalf("want 2 events got %d", len(ev))
	}
	if ev[0].Action != "login_fail" { // newest first
		t.Fatalf("order wrong: %+v", ev)
	}
	if ev[1].Actor != "root" {
		t.Fatalf("actor should resolve to username: %+v", ev[1])
	}
}
