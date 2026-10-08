package httpapi

import (
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
		Database string   `json:"database"`
		Schema   string   `json:"schema"`
		Relation string   `json:"relation"`
		Columns  []string `json:"columns"`
		Limit    int      `json:"limit"`
		Offset   int      `json:"offset"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := engine.PageQuery(r.Context(), sess.DB, engine.PageRequest{
		Engine: sess.Engine, Database: body.Database, Schema: body.Schema,
		Relation: body.Relation, Columns: body.Columns, Limit: body.Limit, Offset: body.Offset,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}
