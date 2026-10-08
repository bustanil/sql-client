package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/bustanil/sql-client/internal/engine"
)

func (s *Server) previewDDL(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	raw, err := readRaw(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sqlText, err := engine.Preview(sess.Engine, raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"sql": sqlText})
}

func (s *Server) executeSQL(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		SQL string `json:"sql"`
	}
	if err := readJSON(r, &body); err != nil || body.SQL == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}
	if _, err := sess.DB.ExecContext(r.Context(), body.SQL); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func readRaw(r *http.Request) (json.RawMessage, error) {
	var raw json.RawMessage
	err := readJSON(r, &raw)
	return raw, err
}
