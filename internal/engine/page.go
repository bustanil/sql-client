package engine

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type Page struct {
	SQL     string   `json:"sql"`
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
	Window  Window   `json:"window"`
}

type Window struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type PageRequest struct {
	Engine   string
	Database string
	Schema   string
	Relation string
	Columns  []string
	Limit    int
	Offset   int
}

func PageQuery(ctx context.Context, db *sql.DB, req PageRequest) (Page, error) {
	if req.Limit != 50 && req.Limit != 100 && req.Limit != 500 {
		req.Limit = 100
	}
	if req.Offset < 0 {
		req.Offset = 0
	}
	cols := req.Columns
	if len(cols) == 0 {
		loaded, err := Columns(ctx, db, req.Engine, schemaOf(req), req.Relation)
		if err != nil {
			return Page{}, err
		}
		for _, col := range loaded {
			cols = append(cols, col.Name)
		}
	}
	if len(cols) == 0 {
		return Page{}, fmt.Errorf("the relation has no columns")
	}
	quoted := make([]string, len(cols))
	for i, name := range cols {
		quoted[i] = Quote(req.Engine, name)
	}
	from := Quote(req.Engine, req.Relation)
	if req.Engine == "PostgreSQL" && req.Schema != "" {
		from = Quote(req.Engine, req.Schema) + "." + from
	}
	statement := fmt.Sprintf("SELECT %s FROM %s LIMIT %d OFFSET %d", strings.Join(quoted, ", "), from, req.Limit, req.Offset)
	rows, err := db.QueryContext(ctx, statement)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	scanned, err := scanPage(rows, len(cols))
	if err != nil {
		return Page{}, err
	}
	start := 0
	if len(scanned) > 0 {
		start = req.Offset + 1
	}
	return Page{SQL: statement, Columns: cols, Rows: scanned, Window: Window{Start: start, End: req.Offset + len(scanned)}}, nil
}

func schemaOf(req PageRequest) string {
	if req.Engine == "MySQL" {
		return req.Database
	}
	return req.Schema
}

func scanPage(rows *sql.Rows, width int) ([][]any, error) {
	out := [][]any{}
	for rows.Next() {
		raw := make([]any, width)
		ptrs := make([]any, width)
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		for i, value := range raw {
			if b, ok := value.([]byte); ok {
				raw[i] = string(b)
			}
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}
