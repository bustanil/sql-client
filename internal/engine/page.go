package engine

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type Page struct {
	SQL             string      `json:"sql"`
	Columns         []string    `json:"columns"`
	ColumnInfo      []Column    `json:"columnInfo"`
	IdentityColumns []string    `json:"identityColumns"`
	Identity        [][]*string `json:"identity"`
	Rows            [][]Cell    `json:"rows"`
	Display         [][]*string `json:"display"`
	Window          Window      `json:"window"`
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
	loaded, err := Columns(ctx, db, req.Engine, schemaOf(req), req.Relation)
	if err != nil {
		return Page{}, err
	}
	if len(loaded) == 0 {
		return Page{}, fmt.Errorf("the relation has no columns")
	}
	names := make([]string, 0, len(loaded))
	info := make(map[string]Column, len(loaded))
	for _, col := range loaded {
		names = append(names, col.Name)
		info[col.Name] = col
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

	// The primary key values travel with every row so the UI can identify a row
	// even when the key columns are hidden. They are never added to the visible
	// columns.
	keyColumns := primaryKeyColumns(loaded)
	queryCols := append([]string{}, cols...)
	for _, name := range keyColumns {
		if !contains(queryCols, name) {
			queryCols = append(queryCols, name)
		}
	}

	quoted := make([]string, len(queryCols))
	for i, name := range queryCols {
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
	scanned, _, err := scanCells(rows, len(queryCols), 0)
	if err != nil {
		return Page{}, err
	}

	visibleInfo := make([]Column, len(cols))
	for i, name := range cols {
		visibleInfo[i] = info[name]
	}
	displayRows := make([][]Cell, len(scanned))
	identity := make([][]*string, len(scanned))
	for i, row := range scanned {
		displayRows[i] = row[:len(cols)]
		key := make([]*string, len(keyColumns))
		for j, name := range keyColumns {
			key[j] = cellText(row[indexOf(queryCols, name)])
		}
		identity[i] = key
	}

	start := 0
	if len(scanned) > 0 {
		start = req.Offset + 1
	}
	return Page{
		SQL: statement, Columns: cols, ColumnInfo: visibleInfo,
		IdentityColumns: keyColumns, Identity: identity, Rows: displayRows,
		Display: textRows(scanned, len(cols)),
		Window:  Window{Start: start, End: req.Offset + len(scanned)},
	}, nil
}

func primaryKeyColumns(cols []Column) []string {
	out := []string{}
	for _, col := range cols {
		if col.PrimaryKey {
			out = append(out, col.Name)
		}
	}
	return out
}

func indexOf(list []string, name string) int {
	for i, item := range list {
		if item == name {
			return i
		}
	}
	return -1
}

// cellText returns nil for SQL NULL and a string for every other value. The
// string keeps large numbers and timestamps exact while the UI holds them in a
// text editor.
func cellText(cell Cell) *string {
	if cell.Null() {
		return nil
	}
	text := cell.Text()
	return &text
}

// textRows mirrors the first width cells of every scanned row as exact text.
// The renderer edits this text, so a bigint above the JavaScript safe integer
// never goes through a JSON number and never loses digits.
func textRows(rows [][]Cell, width int) [][]*string {
	out := make([][]*string, len(rows))
	for i, row := range rows {
		out[i] = make([]*string, width)
		for j := 0; j < width; j++ {
			out[i][j] = cellText(row[j])
		}
	}
	return out
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
