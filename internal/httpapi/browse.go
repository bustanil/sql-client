package httpapi

import (
	"errors"
	"net/http"

	"github.com/bustanil/sql-client/internal/engine"
)

func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		Database string          `json:"database"`
		Schema   string          `json:"schema"`
		Relation string          `json:"relation"`
		Columns  []string        `json:"columns"`
		Filters  []engine.Filter `json:"filters"`
		Sort     *engine.Sort    `json:"sort"`
		Limit    int             `json:"limit"`
		Offset   int             `json:"offset"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := engine.PageQuery(r.Context(), sess.DB, engine.PageRequest{
		Engine: sess.Engine, Database: body.Database, Schema: body.Schema,
		Relation: body.Relation, Columns: body.Columns, Filters: body.Filters, Sort: body.Sort,
		Limit: body.Limit, Offset: body.Offset,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) browseCount(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		Database string          `json:"database"`
		Schema   string          `json:"schema"`
		Relation string          `json:"relation"`
		Columns  []string        `json:"columns"`
		Filters  []engine.Filter `json:"filters"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := engine.Count(r.Context(), sess.DB, engine.PageRequest{
		Engine: sess.Engine, Database: body.Database, Schema: body.Schema,
		Relation: body.Relation, Columns: body.Columns, Filters: body.Filters,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": n})
}

func (s *Server) commitRows(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if sess.ReadOnly {
		writeError(w, http.StatusForbidden, "Read-only connection. Row changes are not allowed.")
		return
	}
	var body struct {
		Database string             `json:"database"`
		Schema   string             `json:"schema"`
		Relation string             `json:"relation"`
		Updates  []engine.RowUpdate `json:"updates"`
		Deletes  []engine.RowDelete `json:"deletes"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Relation == "" {
		writeError(w, http.StatusBadRequest, "relation is required")
		return
	}
	result, err := engine.Mutate(r.Context(), sess.DB, engine.MutateRequest{
		Engine: sess.Engine, Database: body.Database, Schema: body.Schema,
		Relation: body.Relation, Updates: body.Updates, Deletes: body.Deletes,
	})
	if err != nil {
		var invalid *engine.ValidationError
		if errors.As(err, &invalid) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":  invalid.Error(),
				"errors": invalid.Errors,
			})
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) exportCSV(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		Database string          `json:"database"`
		Schema   string          `json:"schema"`
		Relation string          `json:"relation"`
		Columns  []string        `json:"columns"`
		Filters  []engine.Filter `json:"filters"`
		Sort     *engine.Sort    `json:"sort"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	text, truncated, err := engine.ExportCSV(r.Context(), sess.DB, engine.PageRequest{
		Engine: sess.Engine, Database: body.Database, Schema: body.Schema, Relation: body.Relation,
		Columns: body.Columns, Filters: body.Filters, Sort: body.Sort,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if truncated {
		w.Header().Set("X-Truncated", "1")
	}
	w.Header().Set("Content-Type", "text/csv")
	_, _ = w.Write([]byte(text))
}
