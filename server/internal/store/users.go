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
