package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgconn"
)

type QueryResult struct {
	Columns      []string
	Rows         [][]any
	RowsAffected int64
	Truncated    bool
	Message      string
}

func RunStatements(ctx context.Context, db *sql.DB, engineName, text string, maxRows int) (QueryResult, []string, error) {
	if maxRows <= 0 {
		maxRows = 1000
	}
	parts := splitSQL(text)
	messages := []string{}
	var last QueryResult
	for i, part := range parts {
		start := time.Now()
		result, err := runOne(ctx, db, engineName, part, maxRows)
		elapsed := time.Since(start).Milliseconds()
		if err != nil {
			return last, messages, err
		}
		result.Message = fmt.Sprintf("%s · %d ms", result.Message, elapsed)
		messages = append(messages, fmt.Sprintf("statement %d: %s", i+1, result.Message))
		if len(result.Rows) > 0 || len(result.Columns) > 0 {
			last = result
		} else if last.Columns == nil {
			last = result
		}
	}
	last.Message = strings.Join(messages, "\n")
	return last, messages, nil
}

func runOne(ctx context.Context, db *sql.DB, engineName, text string, maxRows int) (QueryResult, error) {
	if rowReturning(text) {
		_ = engineName
		rows, err := db.QueryContext(ctx, text)
		if err != nil {
			return QueryResult{}, err
		}
		defer rows.Close()
		names, err := rows.Columns()
		if err != nil {
			return QueryResult{}, err
		}
		truncated := false
		scanned := [][]any{}
		for rows.Next() {
			if len(scanned) > maxRows {
				truncated = true
				break
			}
			raw := make([]any, len(names))
			ptrs := make([]any, len(names))
			for i := range raw {
				ptrs[i] = &raw[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				return QueryResult{}, err
			}
			for i, value := range raw {
				if b, ok := value.([]byte); ok {
					raw[i] = string(b)
				}
			}
			scanned = append(scanned, raw)
		}
		if err := rows.Err(); err != nil {
			return QueryResult{}, err
		}
		if len(scanned) > maxRows {
			scanned = scanned[:maxRows]
			truncated = true
		}
		return QueryResult{Columns: names, Rows: scanned, Truncated: truncated, Message: fmt.Sprintf("%d rows", len(scanned))}, nil
	}
	res, err := db.ExecContext(ctx, text)
	if err != nil {
		return QueryResult{}, err
	}
	n, _ := res.RowsAffected()
	msg := "Done"
	if n >= 0 {
		msg = fmt.Sprintf("%d rows affected", n)
	}
	return QueryResult{RowsAffected: n, Message: msg}, nil
}

func IsRead(text string) bool {
	switch firstWord(text) {
	case "select", "show", "explain", "values":
		return true
	case "with":
		lower := strings.ToLower(stripComments(text))
		for _, word := range []string{"insert", "update", "delete", "drop", "alter", "truncate", "create"} {
			if strings.Contains(lower, word) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func rowReturning(text string) bool {
	word := firstWord(text)
	switch word {
	case "select", "with", "show", "explain", "values", "table":
		return true
	default:
		return false
	}
}

func firstWord(text string) string {
	s := stripComments(text)
	fields := strings.FieldsFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '(' })
	if len(fields) == 0 {
		return ""
	}
	return strings.ToLower(fields[0])
}

func stripComments(text string) string {
	var b strings.Builder
	inSingle, inLine := false, false
	for i := 0; i < len(text); i++ {
		if inLine {
			if text[i] == '\n' {
				inLine = false
				b.WriteByte('\n')
			}
			continue
		}
		if !inSingle && i+1 < len(text) && text[i] == '-' && text[i+1] == '-' {
			inLine = true
			i++
			continue
		}
		if text[i] == '\'' {
			inSingle = !inSingle
		}
		b.WriteByte(text[i])
	}
	return strings.TrimSpace(b.String())
}

func splitSQL(text string) []string {
	parts := []string{}
	var b strings.Builder
	inSingle := false
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch == '\'' && !inSingle {
			inSingle = true
			b.WriteByte(ch)
			continue
		}
		if ch == '\'' && inSingle {
			inSingle = false
			b.WriteByte(ch)
			continue
		}
		if ch == ';' && !inSingle {
			if stmt := strings.TrimSpace(b.String()); stmt != "" {
				parts = append(parts, stmt)
			}
			b.Reset()
			continue
		}
		b.WriteByte(ch)
	}
	if stmt := strings.TrimSpace(b.String()); stmt != "" {
		parts = append(parts, stmt)
	}
	return parts
}

func ErrorPosition(err error) int {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return int(pgErr.Position)
	}
	return 0
}
