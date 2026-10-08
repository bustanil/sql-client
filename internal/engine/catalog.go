package engine

import (
	"context"
	"database/sql"
)

type Column struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	Default    string `json:"default,omitempty"`
	PrimaryKey bool   `json:"primaryKey"`
}

func Databases(ctx context.Context, db *sql.DB, engineName string, system bool) ([]string, error) {
	if engineName == "MySQL" {
		rows, err := db.QueryContext(ctx, `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		names, err := scanStrings(rows)
		if err != nil {
			return nil, err
		}
		return filterSystem(names, system, mysqlSystem), nil
	}
	rows, err := db.QueryContext(ctx, `SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStrings(rows)
}

func Schemas(ctx context.Context, db *sql.DB, system bool) ([]string, error) {
	q := `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast%'`
	if !system {
		q += ` AND nspname NOT IN ('pg_catalog', 'information_schema')`
	}
	q += ` ORDER BY nspname`
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStrings(rows)
}

func Relations(ctx context.Context, db *sql.DB, engineName, schema, kind string) ([]string, error) {
	if engineName == "MySQL" {
		tableType := "BASE TABLE"
		if kind == "view" {
			tableType = "VIEW"
		}
		rows, err := db.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = ? ORDER BY table_name`, schema, tableType)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanStrings(rows)
	}
	relkind := "r"
	if kind == "view" {
		relkind = "v"
	}
	rows, err := db.QueryContext(ctx, `
		SELECT c.relname
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relkind = $2
		ORDER BY c.relname`, schema, relkind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStrings(rows)
}

func Columns(ctx context.Context, db *sql.DB, engineName, schema, table string) ([]Column, error) {
	if engineName == "MySQL" {
		rows, err := db.QueryContext(ctx, `
			SELECT column_name, column_type, is_nullable = 'YES', IFNULL(column_default, ''), column_key = 'PRI'
			FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ?
			ORDER BY ordinal_position`, schema, table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanColumns(rows)
	}
	rows, err := db.QueryContext(ctx, `
		SELECT a.attname,
		       pg_catalog.format_type(a.atttypid, a.atttypmod),
		       NOT a.attnotnull,
		       COALESCE(pg_get_expr(ad.adbin, ad.adrelid), ''),
		       EXISTS (
		         SELECT 1 FROM pg_index i
		         WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)
		       )
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
		WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanColumns(rows)
}

func scanStrings(rows *sql.Rows) ([]string, error) {
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func scanColumns(rows *sql.Rows) ([]Column, error) {
	out := []Column{}
	for rows.Next() {
		var c Column
		if err := rows.Scan(&c.Name, &c.Type, &c.Nullable, &c.Default, &c.PrimaryKey); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func filterSystem(names []string, system bool, hidden map[string]bool) []string {
	if system {
		return names
	}
	out := []string{}
	for _, name := range names {
		if !hidden[name] {
			out = append(out, name)
		}
	}
	return out
}

var mysqlSystem = map[string]bool{
	"mysql": true, "information_schema": true, "performance_schema": true, "sys": true,
}
