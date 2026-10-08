package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/bustanil/sql-client/internal/engine"
	"github.com/bustanil/sql-client/internal/store"
)

func (s *Server) spawnSession(w http.ResponseWriter, r *http.Request) {
	opened, err := s.Sessions.Spawn(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sessionView{
		SessionID: opened.ID, Engine: opened.Engine, Database: opened.Database,
		ReadOnly: opened.ReadOnly, ConnectionID: opened.ConnectionID,
	})
}

func (s *Server) runQuery(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.Sessions.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		SQL        string `json:"sql"`
		MaxRows    int    `json:"maxRows"`
		TimeoutSec int    `json:"timeoutSec"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.SQL) == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}
	if sess.ReadOnly && !engine.IsRead(body.SQL) {
		writeError(w, http.StatusForbidden, "Read-only connection. This statement was rejected before it reached the server.")
		return
	}
	ctx, stop := context.WithCancel(r.Context())
	defer stop()
	if body.TimeoutSec > 0 {
		var timeoutStop context.CancelFunc
		ctx, timeoutStop = context.WithTimeout(ctx, time.Duration(body.TimeoutSec)*time.Second)
		defer timeoutStop()
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	flush(w)
	var raw [4]byte
	_, _ = rand.Read(raw[:])
	queryID := "q" + hex.EncodeToString(raw[:])
	s.cancels.Store(queryID, stop)
	defer s.cancels.Delete(queryID)
	_ = enc.Encode(map[string]string{"type": "started", "queryId": queryID})
	flush(w)
	started := time.Now()
	result, messages, err := engine.RunStatements(ctx, sess.DB, sess.Engine, body.SQL, body.MaxRows)
	elapsed := time.Since(started).Milliseconds()
	entry := store.HistoryEntry{SQL: body.SQL, At: time.Now(), Database: sess.Database, DurationMs: elapsed, OK: err == nil}
	if err != nil {
		entry.Error = err.Error()
		_ = s.Store.AppendHistory(sess.ConnectionID, entry)
		if ctx.Err() != nil {
			_ = enc.Encode(map[string]string{"type": "canceled"})
			flush(w)
			return
		}
		_ = enc.Encode(queryFailed{Type: "error", Message: err.Error(), Position: engine.ErrorPosition(err)})
		flush(w)
		return
	}
	_ = s.Store.AppendHistory(sess.ConnectionID, entry)
	_ = enc.Encode(queryDone{
		Type: "result", Columns: result.Columns, Rows: result.Rows,
		RowsAffected: result.RowsAffected, Truncated: result.Truncated,
		ElapsedMs: time.Since(started).Milliseconds(), Messages: messages,
	})
	flush(w)
}

func (s *Server) cancelQuery(w http.ResponseWriter, r *http.Request) {
	if cancel, ok := s.cancels.Load(r.PathValue("queryId")); ok {
		cancel.(func())()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	items, err := s.Store.History(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

type queryFailed struct {
	Type     string `json:"type"`
	Message  string `json:"message"`
	Position int    `json:"position"`
}

type queryDone struct {
	Type         string          `json:"type"`
	Columns      []string        `json:"columns"`
	Rows         [][]engine.Cell `json:"rows"`
	RowsAffected int64           `json:"rowsAffected"`
	Truncated    bool            `json:"truncated"`
	ElapsedMs    int64           `json:"elapsedMs"`
	Messages     []string        `json:"messages"`
}

func flush(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
