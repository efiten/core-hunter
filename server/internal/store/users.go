package store

import (
	"database/sql"
	"time"
)

type User struct {
	ID           int64
	Username     string
	Email        string
	PasswordHash string
	Role         string
	Status       string
	CreatedAt    string
	LastLoginAt  string
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func nz(s sql.NullString) string {
	if s.Valid {
		return s.String
	}
	return ""
}

func (s *Store) CreateUser(username, email, passwordHash, role, status string) (int64, error) {
	var em any
	if email == "" {
		em = nil
	} else {
		em = email
	}
	res, err := s.db.Exec(
		`INSERT INTO users(username,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)`,
		username, em, passwordHash, role, status, nowRFC3339())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var email, last sql.NullString
	err := row.Scan(&u.ID, &u.Username, &email, &u.PasswordHash, &u.Role, &u.Status, &u.CreatedAt, &last)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Email, u.LastLoginAt = nz(email), nz(last)
	return &u, nil
}

const userCols = `id,username,email,password_hash,role,status,created_at,last_login_at`

func (s *Store) UserByUsername(username string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE username=?`, username))
}
func (s *Store) UserByID(id int64) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE id=?`, id))
}
func (s *Store) UserByEmail(email string) (*User, error) {
	if email == "" {
		return nil, nil
	}
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE email=?`, email))
}
func (s *Store) SetPassword(id int64, passwordHash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, passwordHash, id)
	return err
}
func (s *Store) SetRoleStatus(id int64, role, status string) error {
	_, err := s.db.Exec(`UPDATE users SET role=?, status=? WHERE id=?`, role, status, id)
	return err
}
func (s *Store) SetLastLogin(id int64, at string) error {
	_, err := s.db.Exec(`UPDATE users SET last_login_at=? WHERE id=?`, at, id)
	return err
}
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT ` + userCols + ` FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var email, last sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &email, &u.PasswordHash, &u.Role, &u.Status, &u.CreatedAt, &last); err != nil {
			return nil, err
		}
		u.Email, u.LastLoginAt = nz(email), nz(last)
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *Store) CountActiveAdmins() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT count(*) FROM users WHERE role='admin' AND status='active'`).Scan(&n)
	return n, err
}

func (s *Store) LinkCompanion(userID int64, pubkey string) error {
	_, err := s.db.Exec(
		`INSERT INTO companions(pubkey,user_id,linked_at) VALUES(?,?,?)
		 ON CONFLICT(pubkey) DO UPDATE SET user_id=excluded.user_id`,
		pubkey, userID, nowRFC3339())
	return err
}
func (s *Store) CompanionsFor(userID int64) ([]string, error) {
	rows, err := s.db.Query(`SELECT pubkey FROM companions WHERE user_id=? ORDER BY linked_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) UserIDForCompanion(pubkey string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT user_id FROM companions WHERE pubkey=?`, pubkey).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

type Session struct {
	TokenHash string
	UserID    int64
	Remember  bool
	ExpiresAt string
	CreatedAt string
	IP        string
}

func (s *Store) CreateSession(tokenHash string, userID int64, remember bool, expiresAt, ip string) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions(token_hash,user_id,remember,expires_at,created_at,ip) VALUES(?,?,?,?,?,?)`,
		tokenHash, userID, remember, expiresAt, nowRFC3339(), ip)
	return err
}
func (s *Store) SessionByTokenHash(tokenHash string) (*Session, error) {
	var se Session
	var ip sql.NullString
	err := s.db.QueryRow(
		`SELECT token_hash,user_id,remember,expires_at,created_at,ip FROM sessions WHERE token_hash=?`,
		tokenHash).Scan(&se.TokenHash, &se.UserID, &se.Remember, &se.ExpiresAt, &se.CreatedAt, &ip)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	se.IP = nz(ip)
	return &se, nil
}
func (s *Store) TouchSession(tokenHash, expiresAt string) error {
	_, err := s.db.Exec(`UPDATE sessions SET expires_at=? WHERE token_hash=?`, expiresAt, tokenHash)
	return err
}
func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash=?`, tokenHash)
	return err
}

type Token struct {
	TokenHash string
	UserID    int64
	Purpose   string
	ExpiresAt string
	UsedAt    string
}

func (s *Store) CreateToken(tokenHash string, userID int64, purpose, expiresAt string) error {
	_, err := s.db.Exec(
		`INSERT INTO tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)`,
		tokenHash, userID, purpose, expiresAt)
	return err
}

// ConsumeToken atomically marks a valid, unexpired, unused token of the given
// purpose as used and returns it. Returns nil when the token is absent, wrong
// purpose, already used, or expired (expiresAt <= now, RFC3339 string compare).
func (s *Store) ConsumeToken(tokenHash, purpose, now, usedAt string) (*Token, error) {
	res, err := s.db.Exec(
		`UPDATE tokens SET used_at=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?`,
		usedAt, tokenHash, purpose, now)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, nil
	}
	var tk Token
	var used sql.NullString
	err = s.db.QueryRow(
		`SELECT token_hash,user_id,purpose,expires_at,used_at FROM tokens WHERE token_hash=?`,
		tokenHash).Scan(&tk.TokenHash, &tk.UserID, &tk.Purpose, &tk.ExpiresAt, &used)
	if err != nil {
		return nil, err
	}
	tk.UsedAt = nz(used)
	return &tk, nil
}

type AuditEvent struct {
	ID      int64
	At      string
	Actor   string
	Action  string
	Target  string
	IP      string
	Details string
}

func (s *Store) AddAudit(actorUserID int64, action, target, ip, details string) error {
	var actor any
	if actorUserID == 0 {
		actor = nil
	} else {
		actor = actorUserID
	}
	_, err := s.db.Exec(
		`INSERT INTO audit_log(at,actor_user_id,action,target,ip,details) VALUES(?,?,?,?,?,?)`,
		nowRFC3339(), actor, action, target, ip, details)
	return err
}
func (s *Store) ListAudit(limit int) ([]AuditEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(
		`SELECT a.id,a.at,COALESCE(u.username,''),a.action,COALESCE(a.target,''),
		        COALESCE(a.ip,''),COALESCE(a.details,'')
		 FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
		 ORDER BY a.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.At, &e.Actor, &e.Action, &e.Target, &e.IP, &e.Details); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
