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
	Rows    [][]Cell `json:"rows"`
	Window  Window   `json:"window"`
}

type Window struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type Filter struct {
	Column string `json:"column"`
	Op     string `json:"op"`
	Value  string `json:"value"`
}

type Sort struct {
	Column string `json:"column"`
	Dir    string `json:"dir"`
}

type PageRequest struct {
	Engine   string
	Database string
	Schema   string
	Relation string
	Columns  []string
	Filters  []Filter
	Sort     *Sort
	Limit    int
	Offset   int
}

func PageQuery(ctx context.Context, db *sql.DB, req PageRequest) (Page, error) {
	if req.Limit != 50 && req.Limit != 100 && req.Limit != 500 && req.Limit != 100000 {
		req.Limit = 100
	}
	if req.Offset < 0 {
		req.Offset = 0
	}
	names, err := relationColumns(ctx, db, req)
	if err != nil {
		return Page{}, err
	}
	cols := req.Columns
	if len(cols) == 0 {
		cols = names
	}
	for _, name := range cols {
		if !contains(names, name) {
			return Page{}, fmt.Errorf("unknown column %s", name)
		}
	}
	quoted := make([]string, len(cols))
	for i, name := range cols {
		quoted[i] = Quote(req.Engine, name)
	}
	statement, args, err := buildSelect(req, quoted, names)
	if err != nil {
		return Page{}, err
	}
	rows, err := db.QueryContext(ctx, statement, queryArgs(args)...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	scanned, _, err := scanCells(rows, len(cols), 0)
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

func relationColumns(ctx context.Context, db *sql.DB, req PageRequest) ([]string, error) {
	loaded, err := Columns(ctx, db, req.Engine, schemaOf(req), req.Relation)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(loaded))
	for _, col := range loaded {
		names = append(names, col.Name)
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("the relation has no columns")
	}
	return names, nil
}

func Count(ctx context.Context, db *sql.DB, req PageRequest) (int, error) {
	req.Sort = nil
	req.Limit = 0
	names, err := relationColumns(ctx, db, req)
	if err != nil {
		return 0, err
	}
	statement, args, err := buildSelect(req, []string{"COUNT(*)"}, names)
	if err != nil {
		return 0, err
	}
	var n int
	err = db.QueryRowContext(ctx, statement, queryArgs(args)...).Scan(&n)
	return n, err
}

func buildSelect(req PageRequest, selectList []string, allowed []string) (string, []string, error) {
	from := Quote(req.Engine, req.Relation)
	if req.Engine == "PostgreSQL" && req.Schema != "" {
		from = Quote(req.Engine, req.Schema) + "." + from
	}
	where, args, err := whereClause(req, allowed)
	if err != nil {
		return "", nil, err
	}
	statement := "SELECT " + strings.Join(selectList, ", ") + " FROM " + from + where
	if req.Sort != nil && contains(allowed, req.Sort.Column) {
		dir := "ASC"
		if strings.EqualFold(req.Sort.Dir, "desc") {
			dir = "DESC"
		}
		statement += " ORDER BY " + Quote(req.Engine, req.Sort.Column) + " " + dir
	}
	if req.Limit > 0 {
		statement += fmt.Sprintf(" LIMIT %d OFFSET %d", req.Limit, req.Offset)
	}
	return statement, args, nil
}

func whereClause(req PageRequest, allowed []string) (string, []string, error) {
	parts := []string{}
	args := []string{}
	for _, filter := range req.Filters {
		if !contains(allowed, filter.Column) {
			continue
		}
		col := Quote(req.Engine, filter.Column)
		switch filter.Op {
		case "empty":
			parts = append(parts, col+" IS NULL")
		case "notempty":
			parts = append(parts, col+" IS NOT NULL")
		case "eq", "neq", "gt", "gte", "lt", "lte", "contains", "like", "ilike":
			args = append(args, filterValue(filter))
			parts = append(parts, compareSQL(req.Engine, col, filter.Op, placeholder(req.Engine, len(args))))
		default:
			return "", nil, fmt.Errorf("unknown filter %s", filter.Op)
		}
	}
	if len(parts) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args, nil
}

func filterValue(filter Filter) string {
	if filter.Op == "contains" {
		return "%" + filter.Value + "%"
	}
	return filter.Value
}

func compareSQL(engineName, column, op, placeholder string) string {
	switch op {
	case "eq":
		return column + " = " + placeholder
	case "neq":
		return column + " <> " + placeholder
	case "gt":
		return column + " > " + placeholder
	case "gte":
		return column + " >= " + placeholder
	case "lt":
		return column + " < " + placeholder
	case "lte":
		return column + " <= " + placeholder
	case "contains", "ilike":
		if engineName == "PostgreSQL" {
			return column + " ILIKE " + placeholder
		}
		return "LOWER(" + column + ") LIKE LOWER(" + placeholder + ")"
	case "like":
		if engineName == "PostgreSQL" {
			return column + " LIKE " + placeholder
		}
		return "BINARY " + column + " LIKE " + placeholder
	default:
		return column + " = " + placeholder
	}
}

func placeholder(engineName string, n int) string {
	if engineName == "PostgreSQL" {
		return fmt.Sprintf("$%d", n)
	}
	return "?"
}

func contains(list []string, name string) bool {
	for _, item := range list {
		if item == name {
			return true
		}
	}
	return false
}

func queryArgs(values []string) []interface{} {
	bound := make([]interface{}, len(values))
	for i, value := range values {
		bound[i] = value
	}
	return bound
}
