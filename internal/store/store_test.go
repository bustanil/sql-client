package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateRejectsDuplicateNameAndOmitsSecrets(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Create(Connection{
		Name: "Local", Engine: "PostgreSQL", Host: "localhost", Port: "5432", User: "app", TLS: "Off",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(Connection{
		Name: "Local", Engine: "MySQL", Host: "localhost", Port: "3306", User: "app", TLS: "Require",
	}); err == nil {
		t.Fatal("expected duplicate name to fail")
	}
	raw, err := os.ReadFile(filepath.Join(s.Dir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "password") {
		t.Fatalf("connection file contains a password field: %s", raw)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded[0]["id"] != first.ID {
		t.Fatalf("id %v", decoded[0]["id"])
	}
}
