package httpapi

import (
	"net/http"

	"github.com/bustanil/sql-client/internal/engine"
	"github.com/bustanil/sql-client/internal/store"
)

func (s *Server) listConnections(w http.ResponseWriter, _ *http.Request) {
	all, err := s.Store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, all)
}

func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	var c store.Connection
	if err := readJSON(r, &c); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	created, err := s.Store.Create(c)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request) {
	var c store.Connection
	if err := readJSON(r, &c); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.Store.Update(r.PathValue("id"), c)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Delete(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type testBody struct {
	store.Connection
	Password string `json:"password"`
}

func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	var body testBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	err := engine.Ping(r.Context(), engine.Target{
		Engine: body.Engine, Host: body.Host, Port: body.Port,
		User: body.User, Password: body.Password, Database: body.Database, TLS: body.TLS,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
