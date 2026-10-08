package httpapi

import (
	"net/http"

	"context"
	"database/sql"

	"github.com/bustanil/sql-client/internal/engine"
)

func (s *Server) switchDatabase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Database string `json:"database"`
	}
	if err := readJSON(r, &body); err != nil || body.Database == "" {
		writeError(w, http.StatusBadRequest, "database is required")
		return
	}
	opened, err := s.Sessions.Switch(r.Context(), r.PathValue("id"), body.Database)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId": opened.ID, "engine": opened.Engine, "database": opened.Database, "readOnly": opened.ReadOnly,
	})
}

func (s *Server) databases(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	names, err := engine.Databases(r.Context(), sess.DB, sess.Engine, r.URL.Query().Get("system") == "1")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, names)
}

func (s *Server) schemas(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if sess.Engine == "MySQL" {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	names, err := engine.Schemas(r.Context(), sess.DB, r.URL.Query().Get("system") == "1")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, names)
}

func (s *Server) tables(w http.ResponseWriter, r *http.Request) {
	s.relations(w, r, "table")
}

func (s *Server) views(w http.ResponseWriter, r *http.Request) {
	s.relations(w, r, "view")
}

func (s *Server) relations(w http.ResponseWriter, r *http.Request, kind string) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	schema := r.URL.Query().Get("schema")
	if sess.Engine == "MySQL" {
		schema = r.URL.Query().Get("database")
		if schema == "" {
			schema = sess.Database
		}
	}
	names, err := engine.Relations(r.Context(), sess.DB, sess.Engine, schema, kind)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, names)
}

func (s *Server) columns(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	schema := r.URL.Query().Get("schema")
	if sess.Engine == "MySQL" {
		schema = r.URL.Query().Get("database")
		if schema == "" {
			schema = sess.Database
		}
	}
	cols, err := engine.Columns(r.Context(), sess.DB, sess.Engine, schema, r.URL.Query().Get("table"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cols)
}

func (s *Server) indexes(w http.ResponseWriter, r *http.Request) {
	s.namedChildren(w, r, engine.Indexes)
}

func (s *Server) foreignKeys(w http.ResponseWriter, r *http.Request) {
	s.namedChildren(w, r, engine.ForeignKeys)
}

func (s *Server) namedChildren(w http.ResponseWriter, r *http.Request, load func(ctx context.Context, db *sql.DB, engineName, schema, table string) ([]string, error)) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	schema := r.URL.Query().Get("schema")
	if sess.Engine == "MySQL" {
		schema = r.URL.Query().Get("database")
		if schema == "" {
			schema = sess.Database
		}
	}
	names, err := load(r.Context(), sess.DB, sess.Engine, schema, r.URL.Query().Get("table"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, names)
}

func (s *Server) complete(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	tables, err := engine.Completion(r.Context(), sess.DB, sess.Engine)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tables": tables})
}
