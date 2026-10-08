package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/bustanil/sql-client/internal/session"
	"github.com/bustanil/sql-client/internal/store"
)

type Server struct {
	Token    string
	Store    *store.Store
	Sessions *session.Manager
	mux      *http.ServeMux
}

func New(token string, st *store.Store) *Server {
	s := &Server{Token: token, Store: st, Sessions: session.NewManager(), mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /connections", s.listConnections)
	s.mux.HandleFunc("POST /connections", s.createConnection)
	s.mux.HandleFunc("PATCH /connections/{id}", s.updateConnection)
	s.mux.HandleFunc("DELETE /connections/{id}", s.deleteConnection)
	s.mux.HandleFunc("POST /connections/test", s.testConnection)
	s.mux.HandleFunc("POST /sessions", s.openSession)
	s.mux.HandleFunc("DELETE /sessions/{id}", s.closeSession)
	s.mux.HandleFunc("POST /sessions/{id}/database", s.switchDatabase)
	s.mux.HandleFunc("GET /sessions/{id}/databases", s.databases)
	s.mux.HandleFunc("GET /sessions/{id}/schemas", s.schemas)
	s.mux.HandleFunc("GET /sessions/{id}/tables", s.tables)
	s.mux.HandleFunc("GET /sessions/{id}/views", s.views)
	s.mux.HandleFunc("GET /sessions/{id}/columns", s.columns)
	s.mux.HandleFunc("POST /sessions/{id}/browse", s.browse)
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) authorized(r *http.Request) bool {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	return strings.HasPrefix(h, prefix) && h[len(prefix):] == s.Token && s.Token != ""
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func Listen(addr string) (net.Listener, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return nil, fmt.Errorf("refusing to listen on %s", addr)
	}
	return net.Listen("tcp", addr)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	defer r.Body.Close()
	if err := dec.Decode(v); err != nil && err != io.EOF {
		return err
	}
	return nil
}
