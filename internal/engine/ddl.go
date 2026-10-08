package engine

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ddlRequest struct {
	Action   string      `json:"action"`
	Name     string      `json:"name"`
	Schema   string      `json:"schema"`
	Database string      `json:"database"`
	Columns  []ddlColumn `json:"columns"`
	Unique   bool        `json:"unique"`
	Table    string      `json:"table"`
	RefTable string      `json:"refTable"`
	RefCols  []string    `json:"refColumns"`
	OnDelete string      `json:"onDelete"`
	OnUpdate string      `json:"onUpdate"`
}

type ddlColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	Default    string `json:"default"`
	PrimaryKey bool   `json:"primaryKey"`
}

func Preview(engineName string, raw json.RawMessage) (string, error) {
	var req ddlRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return "", err
	}
	switch req.Action {
	case "createDatabase":
		return createDatabase(engineName, req.Name), nil
	case "createTable":
		return createTable(engineName, req)
	case "dropDatabase":
		return "DROP DATABASE " + Quote(engineName, req.Name), nil
	case "dropTable":
		return "DROP TABLE " + qualified(engineName, req.Schema, req.Name), nil
	case "dropView":
		return "DROP VIEW " + qualified(engineName, req.Schema, req.Name), nil
	case "dropColumn":
		if len(req.Columns) == 0 {
			return "", fmt.Errorf("column is required")
		}
		return "ALTER TABLE " + qualified(engineName, req.Schema, req.Table) + " DROP COLUMN " + Quote(engineName, req.Columns[0].Name), nil
	case "addColumn":
		if len(req.Columns) == 0 || req.Columns[0].Name == "" {
			return "", fmt.Errorf("column is required")
		}
		return "ALTER TABLE " + qualified(engineName, req.Schema, req.Table) + " ADD COLUMN " + columnSQL(engineName, req.Columns[0]), nil
	case "createIndex":
		return createIndex(engineName, req)
	case "dropIndex":
		if engineName == "MySQL" {
			return "DROP INDEX " + Quote(engineName, req.Name) + " ON " + qualified(engineName, req.Schema, req.Table), nil
		}
		return "DROP INDEX " + qualified(engineName, req.Schema, req.Name), nil
	case "createForeignKey":
		return createForeignKey(engineName, req)
	case "dropForeignKey":
		if engineName == "MySQL" {
			return "ALTER TABLE " + qualified(engineName, req.Schema, req.Table) + " DROP FOREIGN KEY " + Quote(engineName, req.Name), nil
		}
		return "ALTER TABLE " + qualified(engineName, req.Schema, req.Table) + " DROP CONSTRAINT " + Quote(engineName, req.Name), nil
	default:
		return "", fmt.Errorf("unknown action %s", req.Action)
	}
}

func createDatabase(engineName, name string) string {
	ident := Quote(engineName, name)
	if engineName == "MySQL" {
		return "CREATE DATABASE " + ident + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
	}
	return "CREATE DATABASE " + ident
}

func createTable(engineName string, req ddlRequest) (string, error) {
	named := make([]ddlColumn, 0, len(req.Columns))
	for _, col := range req.Columns {
		if col.Name != "" {
			named = append(named, col)
		}
	}
	if req.Name == "" || len(named) == 0 {
		return "", fmt.Errorf("table name and one column are required")
	}
	lines := make([]string, 0, len(named)+1)
	var pk []string
	for _, col := range named {
		lines = append(lines, "  "+columnSQL(engineName, col))
		if col.PrimaryKey {
			pk = append(pk, Quote(engineName, col.Name))
		}
	}
	if len(pk) > 0 {
		lines = append(lines, "  PRIMARY KEY ("+strings.Join(pk, ", ")+")")
	}
	return "CREATE TABLE " + qualified(engineName, req.Schema, req.Name) + " (\n" + strings.Join(lines, ",\n") + "\n)", nil
}

func columnSQL(engineName string, col ddlColumn) string {
	line := Quote(engineName, col.Name) + " " + col.Type
	if col.Nullable && !col.PrimaryKey {
		line += " NULL"
	} else {
		line += " NOT NULL"
	}
	if col.Default != "" {
		line += " DEFAULT " + col.Default
	}
	return line
}

func createIndex(engineName string, req ddlRequest) (string, error) {
	cols := quoteNames(engineName, req.Columns)
	if req.Name == "" || req.Table == "" || len(cols) == 0 {
		return "", fmt.Errorf("index name, table, and one column are required")
	}
	kind := "INDEX"
	if req.Unique {
		kind = "UNIQUE INDEX"
	}
	return "CREATE " + kind + " " + Quote(engineName, req.Name) + " ON " + qualified(engineName, req.Schema, req.Table) + " (" + strings.Join(cols, ", ") + ")", nil
}

func createForeignKey(engineName string, req ddlRequest) (string, error) {
	local := quoteNames(engineName, req.Columns)
	if req.Name == "" || req.Table == "" || req.RefTable == "" || len(local) == 0 || len(local) != len(req.RefCols) {
		return "", fmt.Errorf("foreign key name, columns, and referenced columns are required")
	}
	ref := make([]string, len(req.RefCols))
	for i, name := range req.RefCols {
		ref[i] = Quote(engineName, name)
	}
	onDelete := actionOrDefault(req.OnDelete)
	onUpdate := actionOrDefault(req.OnUpdate)
	return "ALTER TABLE " + qualified(engineName, req.Schema, req.Table) +
		" ADD CONSTRAINT " + Quote(engineName, req.Name) +
		" FOREIGN KEY (" + strings.Join(local, ", ") + ") REFERENCES " + qualified(engineName, req.Schema, req.RefTable) +
		" (" + strings.Join(ref, ", ") + ") ON DELETE " + onDelete + " ON UPDATE " + onUpdate, nil
}

func quoteNames(engineName string, cols []ddlColumn) []string {
	out := []string{}
	for _, col := range cols {
		if col.Name != "" {
			out = append(out, Quote(engineName, col.Name))
		}
	}
	return out
}

func qualified(engineName, schema, name string) string {
	if engineName == "PostgreSQL" && schema != "" {
		return Quote(engineName, schema) + "." + Quote(engineName, name)
	}
	return Quote(engineName, name)
}

func actionOrDefault(action string) string {
	switch strings.ToUpper(action) {
	case "RESTRICT", "CASCADE", "SET NULL", "NO ACTION":
		return strings.ToUpper(action)
	default:
		return "NO ACTION"
	}
}
