package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/efiten/core-hunter/server/internal/store"
)

type AdminAPI struct {
	Store   *store.Store
	Mailer  Mailer
	BaseURL string
}

func (h *AdminAPI) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if AuthOf(r).Role != "admin" {
		writeErr(w, 403, "forbidden")
		return false
	}
	return true
}

type adminUser struct {
	ID          int64    `json:"id"`
	Username    string   `json:"username"`
	Email       string   `json:"email"`
	Role        string   `json:"role"`
	Status      string   `json:"status"`
	Companions  []string `json:"companions"`
	LastLoginAt string   `json:"last_login_at"`
}

func (h *AdminAPI) Users(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		users, err := h.Store.ListUsers()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		out := make([]adminUser, 0, len(users))
		for _, u := range users {
			comps, _ := h.Store.CompanionsFor(u.ID)
			if comps == nil {
				comps = []string{}
			}
			out = append(out, adminUser{u.ID, u.Username, u.Email, u.Role, u.Status, comps, u.LastLoginAt})
		}
		writeJSON(w, map[string]any{"users": out})
	case http.MethodPost:
		var in struct {
			Username string `json:"username"`
			Email    string `json:"email"`
			Role     string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, 400, "bad_json")
			return
		}
		if in.Role == "" {
			in.Role = "member"
		}
		if u, _ := h.Store.UserByUsername(in.Username); u != nil {
			writeErr(w, 409, "username_taken")
			return
		}
		id, err := h.Store.CreateUser(in.Username, in.Email, "", in.Role, "pending")
		if err != nil {
			writeErr(w, 409, "username_taken")
			return
		}
		// set-password token + mail
		if in.Email != "" && h.Mailer != nil {
			raw, hash, err := newResetToken()
			if err == nil {
				exp := time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
				if h.Store.CreateToken(hash, id, "set_password", exp) == nil {
					h.Mailer.SendSetPassword(in.Email, raw)
				}
			}
		}
		h.Store.AddAudit(AuthOf(r).UserID, "invite", in.Username, clientIP(r), in.Role)
		writeJSON(w, map[string]any{"id": id})
	default:
		w.WriteHeader(405)
	}
}

func (h *AdminAPI) UserPatch(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "bad_id")
		return
	}
	u, _ := h.Store.UserByID(id)
	if u == nil {
		writeErr(w, 404, "not_found")
		return
	}
	var in struct {
		Role   *string `json:"role"`
		Status *string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad_json")
		return
	}
	newRole, newStatus := u.Role, u.Status
	if in.Role != nil {
		newRole = *in.Role
	}
	if in.Status != nil {
		newStatus = *in.Status
	}
	// last-admin guard: refuse if this change removes the final active admin
	if u.Role == "admin" && u.Status == "active" && (newRole != "admin" || newStatus != "active") {
		if n, _ := h.Store.CountActiveAdmins(); n <= 1 {
			writeErr(w, 409, "last_admin")
			return
		}
	}
	if err := h.Store.SetRoleStatus(id, newRole, newStatus); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	h.Store.AddAudit(AuthOf(r).UserID, "user_patch", u.Username, clientIP(r), newRole+"/"+newStatus)
	w.WriteHeader(204)
}

func (h *AdminAPI) Audit(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	ev, err := h.Store.ListAudit(limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	out := make([]map[string]any, 0, len(ev))
	for _, e := range ev {
		out = append(out, map[string]any{
			"id": e.ID, "at": e.At, "actor": e.Actor, "action": e.Action,
			"target": e.Target, "ip": e.IP, "details": e.Details,
		})
	}
	writeJSON(w, map[string]any{"events": out})
}
