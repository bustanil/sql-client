package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RowUpdate changes one or more columns of a single row. Identity carries the
// primary-key values that were read with the page, in string form, so a row can
// be found even when the key columns are hidden in the grid.
type RowUpdate struct {
	Row      int                `json:"row"`
	Identity map[string]*string `json:"identity"`
	Changes  map[string]*string `json:"changes"`
}

type RowDelete struct {
	Row      int                `json:"row"`
	Identity map[string]*string `json:"identity"`
}

type MutateRequest struct {
	Engine   string
	Database string
	Schema   string
	Relation string
	Updates  []RowUpdate
	Deletes  []RowDelete
}

type MutateResult struct {
	Updated int `json:"updated"`
	Deleted int `json:"deleted"`
}

// FieldError points at the value that stopped a commit. Row is the index the
// renderer sent for the row, so the grid can keep its dirty edit and highlight
// the right cell.
type FieldError struct {
	Kind    string `json:"kind"`
	Row     int    `json:"row"`
	Column  string `json:"column,omitempty"`
	Message string `json:"message"`
}

type ValidationError struct {
	Errors []FieldError
}

func (e *ValidationError) Error() string {
	switch len(e.Errors) {
	case 0:
		return "The changes could not be saved."
	case 1:
		return e.Errors[0].Message
	default:
		return fmt.Sprintf("%d values need attention before the changes can be saved.", len(e.Errors))
	}
}

func invalid(kind string, row int, column, message string) *ValidationError {
	return &ValidationError{Errors: []FieldError{{Kind: kind, Row: row, Column: column, Message: message}}}
}

// Mutate applies updates and deletes in one transaction. Every value is
// validated before the first statement runs, and a failure rolls the whole
// batch back.
func Mutate(ctx context.Context, db *sql.DB, req MutateRequest) (MutateResult, error) {
	if len(req.Updates) == 0 && len(req.Deletes) == 0 {
		return MutateResult{}, invalid("relation", -1, "", "There are no changes to commit.")
	}
	cols, err := Columns(ctx, db, req.Engine, schemaOf(PageRequest{Engine: req.Engine, Database: req.Database, Schema: req.Schema}), req.Relation)
	if err != nil {
		return MutateResult{}, err
	}
	byName := make(map[string]Column, len(cols))
	for _, col := range cols {
		byName[col.Name] = col
	}
	keyColumns := primaryKeyColumns(cols)
	if len(keyColumns) == 0 {
		return MutateResult{}, invalid("relation", -1, "", "This relation has no primary key, so its rows cannot be changed safely.")
	}

	if err := validateRows(req, byName, keyColumns); err != nil {
		return MutateResult{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MutateResult{}, err
	}
	rollback := func(err error) (MutateResult, error) {
		_ = tx.Rollback()
		return MutateResult{}, err
	}

	result := MutateResult{}
	for _, update := range req.Updates {
		if len(update.Changes) == 0 {
			continue
		}
		statement, args, err := updateStatement(req, update, keyColumns)
		if err != nil {
			return rollback(invalid("update", update.Row, "", err.Error()))
		}
		if _, err := tx.ExecContext(ctx, statement, args...); err != nil {
			return rollback(invalid("update", update.Row, "", err.Error()))
		}
		result.Updated++
	}
	for _, deletion := range req.Deletes {
		statement, args, err := deleteStatement(req, deletion, keyColumns)
		if err != nil {
			return rollback(invalid("delete", deletion.Row, "", err.Error()))
		}
		res, err := tx.ExecContext(ctx, statement, args...)
		if err != nil {
			return rollback(invalid("delete", deletion.Row, "", err.Error()))
		}
		if affected, err := res.RowsAffected(); err == nil && affected == 0 {
			return rollback(invalid("delete", deletion.Row, "", "This row no longer exists. Reload the page and try again."))
		}
		result.Deleted++
	}
	if err := tx.Commit(); err != nil {
		return MutateResult{}, err
	}
	return result, nil
}

func validateRows(req MutateRequest, byName map[string]Column, keyColumns []string) error {
	errors := []FieldError{}
	for _, update := range req.Updates {
		if message := validateIdentity(update.Identity, keyColumns); message != "" {
			errors = append(errors, FieldError{Kind: "update", Row: update.Row, Message: message})
			continue
		}
		errors = append(errors, validateChanges(update.Row, update.Changes, byName)...)
	}
	for _, deletion := range req.Deletes {
		if message := validateIdentity(deletion.Identity, keyColumns); message != "" {
			errors = append(errors, FieldError{Kind: "delete", Row: deletion.Row, Message: message})
		}
	}
	if len(errors) > 0 {
		return &ValidationError{Errors: errors}
	}
	return nil
}

func validateIdentity(identity map[string]*string, keyColumns []string) string {
	for _, name := range keyColumns {
		value, ok := identity[name]
		if !ok || value == nil {
			return fmt.Sprintf("Primary key column %s has no value.", name)
		}
	}
	return ""
}

func validateChanges(row int, changes map[string]*string, byName map[string]Column) []FieldError {
	errors := []FieldError{}
	names := make([]string, 0, len(changes))
	for name := range changes {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		col, ok := byName[name]
		if !ok {
			errors = append(errors, FieldError{Kind: "update", Row: row, Column: name, Message: fmt.Sprintf("Unknown column %s.", name)})
			continue
		}
		value := changes[name]
		if value == nil {
			if !col.Nullable {
				errors = append(errors, FieldError{Kind: "update", Row: row, Column: name, Message: fmt.Sprintf("%s does not allow NULL.", name)})
			}
			continue
		}
		if message := validateFieldValue(col.Type, *value); message != "" {
			errors = append(errors, FieldError{Kind: "update", Row: row, Column: name, Message: message})
		}
	}
	return errors
}

type fieldKind int

const (
	fieldText fieldKind = iota
	fieldInteger
	fieldNumber
	fieldBoolean
	fieldDate
	fieldTime
	fieldTimestamp
	fieldJSON
)

var (
	integerPattern   = regexp.MustCompile(`^[+-]?\d+$`)
	numberPattern    = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`)
	datePattern      = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	timestampPattern = regexp.MustCompile(
		`^(\d{4})-(\d{2})-(\d{2})([ T](\d{2}):(\d{2})(:(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$`,
	)
)

func kindOf(columnType string) fieldKind {
	base := strings.ToLower(strings.TrimSpace(columnType))
	if i := strings.Index(base, "("); i >= 0 {
		base = strings.TrimSpace(base[:i])
	}
	base = strings.ReplaceAll(base, " unsigned", "")
	base = strings.ReplaceAll(base, " zerofill", "")
	if strings.HasSuffix(base, "[]") {
		return fieldText
	}
	switch base {
	case "smallint", "integer", "bigint", "int", "int2", "int4", "int8",
		"tinyint", "mediumint", "year", "serial", "smallserial", "bigserial":
		return fieldInteger
	case "numeric", "decimal", "real", "double", "double precision", "float", "float4", "float8", "money":
		return fieldNumber
	case "boolean", "bool":
		return fieldBoolean
	case "date":
		return fieldDate
	case "time", "time without time zone", "time with time zone", "timetz":
		return fieldTime
	case "timestamp", "timestamp without time zone", "timestamp with time zone", "timestamptz", "datetime":
		return fieldTimestamp
	case "json", "jsonb":
		return fieldJSON
	default:
		return fieldText
	}
}

func validateFieldValue(columnType, value string) string {
	switch kindOf(columnType) {
	case fieldInteger:
		if !integerPattern.MatchString(strings.TrimSpace(value)) {
			return "Expected a whole number."
		}
	case fieldNumber:
		if !numberPattern.MatchString(strings.TrimSpace(value)) {
			return "Expected a number."
		}
	case fieldBoolean:
		if _, err := strconv.ParseBool(strings.TrimSpace(value)); err != nil {
			return "Expected true or false."
		}
	case fieldDate:
		if !validDate(value) {
			return "Expected a date in YYYY-MM-DD form."
		}
	case fieldTime:
		if !validClock(value) {
			return "Expected a time in HH:MM or HH:MM:SS form."
		}
	case fieldTimestamp:
		if !validTimestamp(value) {
			return "Expected a timestamp in YYYY-MM-DD HH:MM:SS form."
		}
	case fieldJSON:
		if !json.Valid([]byte(value)) {
			return "Expected valid JSON."
		}
	}
	return ""
}

func validDate(value string) bool {
	m := datePattern.FindStringSubmatch(strings.TrimSpace(value))
	if m == nil {
		return false
	}
	year, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	day, _ := strconv.Atoi(m[3])
	return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

func validClock(value string) bool {
	clock := strings.TrimSpace(value)
	if !strings.Contains(clock, ":") {
		return false
	}
	// A time coming back from a driver can include a date and a zone. Keep the
	// clock part so direct edits of those values still validate.
	if i := strings.Index(clock, "T"); i >= 0 {
		clock = clock[i+1:]
	} else if i := strings.Index(clock, " "); i >= 0 {
		clock = clock[i+1:]
	}
	clock = strings.TrimSuffix(clock, "Z")
	if i := strings.IndexAny(clock, "+-"); i > 0 {
		clock = clock[:i]
	}
	parts := strings.Split(clock, ":")
	if len(parts) != 2 && len(parts) != 3 {
		return false
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil || hour < 0 || hour > 23 {
		return false
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil || minute < 0 || minute > 59 {
		return false
	}
	if len(parts) == 3 {
		second := strings.SplitN(parts[2], ".", 2)[0]
		value, err := strconv.Atoi(second)
		if err != nil || value < 0 || value > 59 {
			return false
		}
	}
	return true
}

func validTimestamp(value string) bool {
	trimmed := strings.TrimSpace(value)
	switch strings.ToLower(trimmed) {
	case "infinity", "-infinity", "now":
		return true
	}
	m := timestampPattern.FindStringSubmatch(trimmed)
	if m == nil {
		return false
	}
	year, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	day, _ := strconv.Atoi(m[3])
	if month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) {
		return false
	}
	if m[4] == "" {
		return true
	}
	hour, _ := strconv.Atoi(m[5])
	minute, _ := strconv.Atoi(m[6])
	if hour > 23 || minute > 59 {
		return false
	}
	if m[8] != "" {
		second, _ := strconv.Atoi(m[8])
		if second > 59 {
			return false
		}
	}
	if zone := m[10]; zone != "" && zone != "Z" {
		digits := strings.ReplaceAll(zone[1:], ":", "")
		if len(digits) != 2 && len(digits) != 4 {
			return false
		}
		offset, err := strconv.Atoi(digits)
		if err != nil {
			return false
		}
		if len(digits) == 2 {
			offset *= 100
		}
		if offset/100 > 23 || offset%100 > 59 {
			return false
		}
	}
	return true
}

func daysInMonth(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func updateStatement(req MutateRequest, update RowUpdate, keyColumns []string) (string, []any, error) {
	names := make([]string, 0, len(update.Changes))
	for name := range update.Changes {
		names = append(names, name)
	}
	if len(names) == 0 {
		return "", nil, fmt.Errorf("no columns to update")
	}
	sort.Strings(names)
	sets := make([]string, 0, len(names))
	args := make([]any, 0, len(names)+len(keyColumns))
	for _, name := range names {
		args = append(args, nullableValue(update.Changes[name]))
		sets = append(sets, Quote(req.Engine, name)+" = "+placeholder(req.Engine, len(args)))
	}
	where, whereArgs := identityClause(req.Engine, keyColumns, update.Identity, len(args))
	args = append(args, whereArgs...)
	statement := "UPDATE " + qualified(req.Engine, req.Schema, req.Relation) +
		" SET " + strings.Join(sets, ", ") + " WHERE " + where
	return statement, args, nil
}

func deleteStatement(req MutateRequest, deletion RowDelete, keyColumns []string) (string, []any, error) {
	where, args := identityClause(req.Engine, keyColumns, deletion.Identity, 0)
	statement := "DELETE FROM " + qualified(req.Engine, req.Schema, req.Relation) + " WHERE " + where
	return statement, args, nil
}

func identityClause(engineName string, keyColumns []string, identity map[string]*string, offset int) (string, []any) {
	parts := make([]string, 0, len(keyColumns))
	args := make([]any, 0, len(keyColumns))
	for _, name := range keyColumns {
		args = append(args, nullableValue(identity[name]))
		parts = append(parts, Quote(engineName, name)+" = "+placeholder(engineName, offset+len(args)))
	}
	return strings.Join(parts, " AND "), args
}

func nullableValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
