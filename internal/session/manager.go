package session

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"sync"

	"github.com/bustanil/sql-client/internal/engine"
	"github.com/bustanil/sql-client/internal/store"
)

type Session struct {
	ID       string  `json:"sessionId"`
	Engine   string  `json:"engine"`
	Database string  `json:"database"`
	ReadOnly bool    `json:"readOnly"`
	DB       *sql.DB `json:"-"`
}

type Manager struct {
	mu    sync.Mutex
	items map[string]*Session
}

func NewManager() *Manager {
	return &Manager{items: map[string]*Session{}}
}

type OpenRequest struct {
	Connection store.Connection
	Password   string
	Database   string
}

func (m *Manager) Open(ctx context.Context, req OpenRequest) (*Session, error) {
	target := engine.Target{
		Engine: req.Connection.Engine, Host: req.Connection.Host, Port: req.Connection.Port,
		User: req.Connection.User, Password: req.Password, Database: req.Connection.Database, TLS: req.Connection.TLS,
	}
	if req.Database != "" {
		target.Database = req.Database
	}
	db, err := engine.Open(ctx, target)
	if err != nil {
		return nil, err
	}
	database := currentDatabase(ctx, db, target.Engine)
	if database == "" {
		database = target.Database
	}
	s := &Session{
		ID: newID(), Engine: target.Engine, Database: database, ReadOnly: req.Connection.ReadOnly, DB: db,
	}
	m.mu.Lock()
	m.items[s.ID] = s
	m.mu.Unlock()
	return s, nil
}

func currentDatabase(ctx context.Context, db *sql.DB, engineName string) string {
	q := "SELECT DATABASE()"
	if engineName == "PostgreSQL" {
		q = "SELECT current_database()"
	}
	var name sql.NullString
	if err := db.QueryRowContext(ctx, q).Scan(&name); err != nil {
		return ""
	}
	return name.String
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.items[id]
	return s, ok
}

func (m *Manager) Close(id string) {
	m.mu.Lock()
	s := m.items[id]
	delete(m.items, id)
	m.mu.Unlock()
	if s != nil && s.DB != nil {
		_ = s.DB.Close()
	}
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "s" + hex.EncodeToString(b[:])
}
