package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type Connection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Engine   string `json:"engine"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Database string `json:"database"`
	TLS      string `json:"tls"`
	ReadOnly bool   `json:"readOnly"`
}

type Store struct {
	mu   sync.Mutex
	dir  string
	path string
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, path: filepath.Join(dir, "connections.json")}
	if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(s.path, []byte("[]\n"), 0o644); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) List() ([]Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *Store) Create(c Connection) (Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validate(c); err != nil {
		return Connection{}, err
	}
	all, err := s.read()
	if err != nil {
		return Connection{}, err
	}
	if nameTaken(all, c.Name, "") {
		return Connection{}, errors.New("a connection with that name already exists")
	}
	c.ID = newID()
	all = append(all, c)
	return c, s.write(all)
}

func (s *Store) Update(id string, c Connection) (Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validate(c); err != nil {
		return Connection{}, err
	}
	all, err := s.read()
	if err != nil {
		return Connection{}, err
	}
	if nameTaken(all, c.Name, id) {
		return Connection{}, errors.New("a connection with that name already exists")
	}
	for i := range all {
		if all[i].ID == id {
			c.ID = id
			all[i] = c
			return c, s.write(all)
		}
	}
	return Connection{}, errors.New("connection not found")
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.read()
	if err != nil {
		return err
	}
	next := all[:0]
	found := false
	for _, c := range all {
		if c.ID == id {
			found = true
			continue
		}
		next = append(next, c)
	}
	if !found {
		return errors.New("connection not found")
	}
	return s.write(next)
}

func (s *Store) Get(id string) (Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.read()
	if err != nil {
		return Connection{}, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, nil
		}
	}
	return Connection{}, errors.New("connection not found")
}

func validate(c Connection) error {
	if c.Name == "" || c.Host == "" || c.Port == "" || c.User == "" {
		return errors.New("name, host, port, and username are required")
	}
	if c.Engine != "PostgreSQL" && c.Engine != "MySQL" {
		return errors.New("engine must be PostgreSQL or MySQL")
	}
	switch c.TLS {
	case "Off", "Require", "Verify":
	default:
		return errors.New("tls must be Off, Require, or Verify")
	}
	return nil
}

func nameTaken(all []Connection, name, exceptID string) bool {
	for _, c := range all {
		if c.Name == name && c.ID != exceptID {
			return true
		}
	}
	return false
}

func (s *Store) read() ([]Connection, error) {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var all []Connection
	if len(b) == 0 {
		return []Connection{}, nil
	}
	if err := json.Unmarshal(b, &all); err != nil {
		return nil, err
	}
	if all == nil {
		all = []Connection{}
	}
	return all, nil
}

func (s *Store) write(all []Connection) error {
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "c" + hex.EncodeToString(b[:])
}
