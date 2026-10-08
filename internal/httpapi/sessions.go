package httpapi

import (
	"net/http"

	"github.com/bustanil/sql-client/internal/session"
)

type sessionBody struct {
	ConnectionID string `json:"connectionId"`
	Password     string `json:"password"`
	Role         string `json:"role"`
	Database     string `json:"database"`
}

func (s *Server) openSession(w http.ResponseWriter, r *http.Request) {
	var body sessionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	conn, err := s.Store.Get(body.ConnectionID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	opened, err := s.Sessions.Open(r.Context(), session.OpenRequest{
		Connection: conn, Password: body.Password, Database: body.Database,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"sessionId": opened.ID, "engine": opened.Engine, "database": opened.Database,
		"readOnly": opened.ReadOnly, "connectionId": opened.ConnectionID,
	})
}

func (s *Server) closeSession(w http.ResponseWriter, r *http.Request) {
	s.Sessions.Close(r.PathValue("id"))
	w.WriteHeader(http.StatusNoContent)
}
