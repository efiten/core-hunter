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
