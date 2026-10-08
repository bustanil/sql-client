package engine

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const dialTimeout = 10 * time.Second

func init() {
	_ = mysql.RegisterTLSConfig("sqlc-require", &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12})
	_ = mysql.RegisterTLSConfig("sqlc-verify", &tls.Config{MinVersion: tls.VersionTLS12})
}

type Target struct {
	Engine   string
	Host     string
	Port     string
	User     string
	Password string
	Database string
	TLS      string
}

func Ping(ctx context.Context, t Target) error {
	ctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	driver, dsn, err := dsnFor(t)
	if err != nil {
		return err
	}
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var one int
	return db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}

func dsnFor(t Target) (driver, dsn string, err error) {
	switch t.Engine {
	case "PostgreSQL":
		return "pgx", postgresDSN(t), nil
	case "MySQL":
		dsn, err = mysqlDSN(t)
		return "mysql", dsn, err
	default:
		return "", "", fmt.Errorf("engine must be PostgreSQL or MySQL")
	}
}

func postgresDSN(t Target) string {
	db := t.Database
	if db == "" {
		db = "postgres"
	}
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(t.Host, t.Port), Path: "/" + db}
	if t.Password == "" {
		u.User = url.User(t.User)
	} else {
		u.User = url.UserPassword(t.User, t.Password)
	}
	q := u.Query()
	switch t.TLS {
	case "Require":
		q.Set("sslmode", "require")
	case "Verify":
		q.Set("sslmode", "verify-full")
	default:
		q.Set("sslmode", "disable")
	}
	q.Set("connect_timeout", "10")
	u.RawQuery = q.Encode()
	return u.String()
}

func mysqlDSN(t Target) (string, error) {
	cfg := mysql.NewConfig()
	cfg.User = t.User
	cfg.Passwd = t.Password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(t.Host, t.Port)
	cfg.DBName = t.Database
	cfg.Timeout = dialTimeout
	cfg.ReadTimeout = dialTimeout
	cfg.WriteTimeout = dialTimeout
	cfg.ParseTime = true
	cfg.AllowNativePasswords = true
	switch t.TLS {
	case "Require":
		cfg.TLSConfig = "sqlc-require"
	case "Verify":
		cfg.TLSConfig = "sqlc-verify"
	default:
		cfg.TLSConfig = "false"
	}
	return cfg.FormatDSN(), nil
}
