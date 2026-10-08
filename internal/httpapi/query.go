package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/bustanil/sql-client/internal/engine"
)

func (s *Server) spawnSession(w http.ResponseWriter, r *http.Request) {
	opened, err := s.Sessions.Spawn(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"sessionId": opened.ID, "engine": opened.Engine, "database": opened.Database, "readOnly": opened.ReadOnly,
	})
}

func (s *Server) runQuery(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		SQL     string `json:"sql"`
		MaxRows int    `json:"maxRows"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.SQL) == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	flush(w)
	var raw [4]byte
	_, _ = rand.Read(raw[:])
	queryID := "q" + hex.EncodeToString(raw[:])
	_ = enc.Encode(map[string]string{"type": "started", "queryId": queryID})
	flush(w)
	started := time.Now()
	result, messages, err := engine.RunStatements(r.Context(), sess.DB, sess.Engine, body.SQL, body.MaxRows)
	if err != nil {
		if r.Context().Err() != nil {
			_ = enc.Encode(map[string]string{"type": "canceled"})
			flush(w)
			return
		}
		_ = enc.Encode(map[string]any{"type": "error", "message": err.Error(), "position": engine.ErrorPosition(err)})
		flush(w)
		return
	}
	_ = enc.Encode(map[string]any{
		"type": "result", "columns": result.Columns, "rows": result.Rows,
		"rowsAffected": result.RowsAffected, "truncated": result.Truncated,
		"elapsedMs": time.Since(started).Milliseconds(), "messages": messages,
	})
	flush(w)
}

func flush(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
