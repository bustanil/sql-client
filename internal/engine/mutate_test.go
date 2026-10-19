package engine

import (
	"errors"
	"strings"
	"testing"
)

func text(value string) *string { return &value }

func TestKindOf(t *testing.T) {
	cases := map[string]fieldKind{
		"integer":                     fieldInteger,
		"bigint":                      fieldInteger,
		"int(11)":                     fieldInteger,
		"int(11) unsigned":            fieldInteger,
		"bigint unsigned":             fieldInteger,
		"int unsigned zerofill":       fieldInteger,
		"numeric(10,2)":               fieldNumber,
		"double precision":            fieldNumber,
		"boolean":                     fieldBoolean,
		"bool":                        fieldBoolean,
		"date":                        fieldDate,
		"time without time zone":      fieldTime,
		"time(3) with time zone":      fieldTime,
		"timestamp without time zone": fieldTimestamp,
		"timestamp(3) with time zone": fieldTimestamp,
		"timestamptz":                 fieldTimestamp,
		"datetime":                    fieldTimestamp,
		"jsonb":                       fieldJSON,
		"character varying(255)":      fieldText,
		"integer[]":                   fieldText,
		"uuid":                        fieldText,
	}
	for columnType, want := range cases {
		if got := kindOf(columnType); got != want {
			t.Errorf("kindOf(%q) = %v, want %v", columnType, got, want)
		}
	}
}

func TestValidateFieldValue(t *testing.T) {
	valid := []struct{ columnType, value string }{
		{"integer", "-42"},
		{"numeric(10,2)", "12.50"},
		{"double precision", "1e-3"},
		{"boolean", "true"},
		{"boolean", "0"},
		{"date", "2026-10-19"},
		{"time without time zone", "10:19"},
		{"time without time zone", "10:19:36.123"},
		{"timestamp without time zone", "2026-10-19 10:19:36"},
		{"timestamp with time zone", "2026-10-19T10:19:36.123456+08:00"},
		{"jsonb", `{"ok":true}`},
		{"character varying(255)", "anything"},
	}
	for _, tc := range valid {
		if message := validateFieldValue(tc.columnType, tc.value); message != "" {
			t.Errorf("%s %q rejected: %s", tc.columnType, tc.value, message)
		}
	}

	invalid := []struct{ columnType, value string }{
		{"integer", "1.5"},
		{"numeric(10,2)", "abc"},
		{"boolean", "maybe"},
		{"date", "2026-02-30"},
		{"time without time zone", "25:00"},
		{"timestamp without time zone", "yesterday"},
		{"jsonb", `{"ok":`},
	}
	for _, tc := range invalid {
		if message := validateFieldValue(tc.columnType, tc.value); message == "" {
			t.Errorf("%s %q should be rejected", tc.columnType, tc.value)
		}
	}
}

func TestValidTimestamp(t *testing.T) {
	valid := []string{
		"2026-10-19",
		"2026-10-19 10:19",
		"2026-10-19 10:19:36",
		"2026-10-19T10:19:36.123456Z",
		"2026-10-19T10:19:36+08:00",
		"2026-10-19T10:19:36-0800",
		"infinity",
	}
	for _, value := range valid {
		if !validTimestamp(value) {
			t.Errorf("validTimestamp(%q) = false", value)
		}
	}
	invalid := []string{
		"",
		"yesterday",
		"2026-02-30",
		"2026-13-01",
		"2026-10-19T25:00:00",
		"2026-10-19T10:60:00",
		"2026-10-19T10:19:36+25:00",
	}
	for _, value := range invalid {
		if validTimestamp(value) {
			t.Errorf("validTimestamp(%q) = true", value)
		}
	}
}

func TestValidClock(t *testing.T) {
	valid := []string{"10:19", "10:19:36", "10:19:36.123", "10:19:36+08:00", "0000-01-01T10:19:36Z"}
	for _, value := range valid {
		if !validClock(value) {
			t.Errorf("validClock(%q) = false", value)
		}
	}
	invalid := []string{"", "25:00", "10:60", "10", "hello"}
	for _, value := range invalid {
		if validClock(value) {
			t.Errorf("validClock(%q) = true", value)
		}
	}
}

func TestUpdateStatementPostgres(t *testing.T) {
	req := MutateRequest{Engine: "PostgreSQL", Schema: "public", Relation: "users"}
	update := RowUpdate{
		Row:      0,
		Identity: map[string]*string{"id": text("5")},
		Changes:  map[string]*string{"email": text("ada@example.com"), "active": text("true")},
	}
	statement, args, err := updateStatement(req, update, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := `UPDATE "public"."users" SET "active" = $1, "email" = $2 WHERE "id" = $3`
	if statement != want {
		t.Fatalf("statement = %s, want %s", statement, want)
	}
	if len(args) != 3 || args[0] != "true" || args[1] != "ada@example.com" || args[2] != "5" {
		t.Fatalf("args = %#v", args)
	}
}

func TestUpdateStatementMySQLKeepsNull(t *testing.T) {
	req := MutateRequest{Engine: "MySQL", Database: "app", Relation: "users"}
	update := RowUpdate{
		Row:      1,
		Identity: map[string]*string{"tenant": text("acme"), "id": text("7")},
		Changes:  map[string]*string{"deleted_at": nil, "email": text("ada@example.com")},
	}
	statement, args, err := updateStatement(req, update, []string{"tenant", "id"})
	if err != nil {
		t.Fatal(err)
	}
	want := "UPDATE `users` SET `deleted_at` = ?, `email` = ? WHERE `tenant` = ? AND `id` = ?"
	if statement != want {
		t.Fatalf("statement = %s, want %s", statement, want)
	}
	if len(args) != 4 || args[0] != nil || args[1] != "ada@example.com" || args[2] != "acme" || args[3] != "7" {
		t.Fatalf("args = %#v", args)
	}
}

func TestDeleteStatement(t *testing.T) {
	req := MutateRequest{Engine: "PostgreSQL", Schema: "public", Relation: "users"}
	statement, args, err := deleteStatement(req, RowDelete{Row: 2, Identity: map[string]*string{"id": text("9")}}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := `DELETE FROM "public"."users" WHERE "id" = $1`
	if statement != want {
		t.Fatalf("statement = %s, want %s", statement, want)
	}
	if len(args) != 1 || args[0] != "9" {
		t.Fatalf("args = %#v", args)
	}
}

func TestValidateChanges(t *testing.T) {
	columns := map[string]Column{
		"id":         {Name: "id", Type: "integer", PrimaryKey: true},
		"email":      {Name: "email", Type: "character varying(255)", Nullable: false},
		"created_at": {Name: "created_at", Type: "timestamp with time zone", Nullable: true},
		"score":      {Name: "score", Type: "numeric(5,2)", Nullable: true},
		"active":     {Name: "active", Type: "boolean", Nullable: false},
	}
	ok := validateChanges(3, map[string]*string{
		"email":      text("ada@example.com"),
		"created_at": text("2026-10-19T10:19:36+08:00"),
		"score":      text("12.5"),
		"active":     text("true"),
	}, columns)
	if len(ok) != 0 {
		t.Fatalf("unexpected errors: %#v", ok)
	}

	errors := validateChanges(3, map[string]*string{
		"email":      nil,
		"created_at": text("yesterday"),
		"score":      text("abc"),
		"active":     text("maybe"),
		"missing":    text("x"),
	}, columns)
	if len(errors) != 5 {
		t.Fatalf("errors = %#v", errors)
	}
	for _, field := range errors {
		if field.Row != 3 || field.Kind != "update" {
			t.Fatalf("unexpected field error: %#v", field)
		}
	}
	foundNull := false
	for _, field := range errors {
		if field.Column == "email" && strings.Contains(field.Message, "does not allow NULL") {
			foundNull = true
		}
	}
	if !foundNull {
		t.Fatalf("errors = %#v", errors)
	}
}

func TestValidateRowsNeedsIdentity(t *testing.T) {
	columns := map[string]Column{"id": {Name: "id", Type: "integer", PrimaryKey: true}}
	err := validateRows(MutateRequest{
		Updates: []RowUpdate{{Row: 0, Identity: map[string]*string{}, Changes: map[string]*string{"id": text("1")}}},
		Deletes: []RowDelete{{Row: 1, Identity: map[string]*string{"id": text("2")}}},
	}, columns, []string{"id"})
	var invalid *ValidationError
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v", err)
	}
	if len(invalid.Errors) != 1 || invalid.Errors[0].Row != 0 {
		t.Fatalf("errors = %#v", invalid.Errors)
	}
}

func TestValidationErrorMessage(t *testing.T) {
	if got := (&ValidationError{Errors: []FieldError{{Message: "bad value"}}}).Error(); got != "bad value" {
		t.Fatal(got)
	}
	if got := (&ValidationError{Errors: []FieldError{{Message: "a"}, {Message: "b"}}}).Error(); !strings.Contains(got, "2 values") {
		t.Fatal(got)
	}
}

func TestPrimaryKeyColumnsAndCellText(t *testing.T) {
	cols := []Column{
		{Name: "id", PrimaryKey: true},
		{Name: "email"},
		{Name: "tenant", PrimaryKey: true},
	}
	keys := primaryKeyColumns(cols)
	if len(keys) != 2 || keys[0] != "id" || keys[1] != "tenant" {
		t.Fatalf("keys = %#v", keys)
	}
	var cell Cell
	_ = cell.Scan(int64(9007199254740993))
	if text := cellText(cell); text == nil || *text != "9007199254740993" {
		t.Fatalf("cellText = %v", text)
	}
	var null Cell
	if cellText(null) != nil {
		t.Fatal("NULL should stay NULL")
	}
}
