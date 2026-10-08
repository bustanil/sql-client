package engine

import (
	"strings"
	"testing"
)

func TestPostgresDSNEscapesPasswordAndTLS(t *testing.T) {
	dsn := postgresDSN(Target{
		Engine: "PostgreSQL", Host: "localhost", Port: "5432",
		User: "app", Password: "p@ss word", Database: "", TLS: "Verify",
	})
	if !strings.Contains(dsn, "sslmode=verify-full") {
		t.Fatalf("sslmode: %s", dsn)
	}
	if !strings.Contains(dsn, "/postgres") {
		t.Fatalf("default database: %s", dsn)
	}
	if !strings.Contains(dsn, "search_path=public") {
		t.Fatalf("search_path: %s", dsn)
	}
	if strings.Contains(dsn, "p@ss word") {
		t.Fatalf("password was not escaped: %s", dsn)
	}
}

func TestMySQLDSNUsesRequireTLS(t *testing.T) {
	dsn, err := mysqlDSN(Target{
		Engine: "MySQL", Host: "10.0.0.14", Port: "3306", User: "shop", TLS: "Require",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dsn, "tls=sqlc-require") {
		t.Fatalf("dsn %s", dsn)
	}
	if !strings.Contains(dsn, "10.0.0.14:3306") {
		t.Fatalf("dsn %s", dsn)
	}
}
