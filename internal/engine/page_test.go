package engine

import "testing"

func TestBuildSelectUsesParameters(t *testing.T) {
	sqlText, args, err := buildSelect(PageRequest{
		Engine: "PostgreSQL", Schema: "public", Relation: "users",
		Filters: []Filter{{Column: "email", Op: "contains", Value: "ada"}},
		Sort:    &Sort{Column: "created_at", Dir: "desc"},
		Limit:   100,
	}, []string{`"email"`}, []string{"email", "created_at"})
	if err != nil {
		t.Fatal(err)
	}
	if sqlText != `SELECT "email" FROM "public"."users" WHERE "email" ILIKE $1 ORDER BY "created_at" DESC LIMIT 100 OFFSET 0` {
		t.Fatal(sqlText)
	}
	if args[0] != "%ada%" {
		t.Fatal(args)
	}
}

func TestFiltersAreCombinedWithAnd(t *testing.T) {
	sqlText, args, err := buildSelect(PageRequest{
		Engine: "PostgreSQL", Schema: "public", Relation: "users",
		Filters: []Filter{
			{Column: "email", Op: "ilike", Value: "%ada%"},
			{Column: "active", Op: "eq", Value: "true"},
			{Column: "name", Op: "like", Value: "Ada%"},
		},
	}, []string{`"email"`}, []string{"email", "active", "name"})
	if err != nil {
		t.Fatal(err)
	}
	want := `SELECT "email" FROM "public"."users" WHERE "email" ILIKE $1 AND "active" = $2 AND "name" LIKE $3`
	if sqlText != want {
		t.Fatal(sqlText)
	}
	if len(args) != 3 || args[0] != "%ada%" || args[1] != "true" || args[2] != "Ada%" {
		t.Fatal(args)
	}
}

func TestTextRowsKeepsExactNumbers(t *testing.T) {
	rows := [][]Cell{make([]Cell, 3), make([]Cell, 3)}
	_ = rows[0][0].Scan(int64(9007199254740993))
	_ = rows[0][1].Scan("ada")
	_ = rows[0][2].Scan(true)
	_ = rows[1][0].Scan(nil)
	_ = rows[1][1].Scan(1.5)
	_ = rows[1][2].Scan([]byte("bytes"))
	text := textRows(rows, 3)
	if len(text) != 2 || len(text[0]) != 3 {
		t.Fatalf("shape %#v", text)
	}
	if *text[0][0] != "9007199254740993" || *text[0][1] != "ada" || *text[0][2] != "true" {
		t.Fatalf("row 0 %#v", text[0])
	}
	if text[1][0] != nil || *text[1][1] != "1.5" || *text[1][2] != "bytes" {
		t.Fatalf("row 1 %#v", text[1])
	}
}

func TestFilterAllowsHiddenColumn(t *testing.T) {
	sqlText, _, err := buildSelect(PageRequest{
		Engine: "PostgreSQL", Schema: "public", Relation: "users",
		Filters: []Filter{{Column: "email", Op: "eq", Value: "ada"}},
	}, []string{`"id"`}, []string{"id", "email"})
	if err != nil {
		t.Fatal(err)
	}
	if sqlText != `SELECT "id" FROM "public"."users" WHERE "email" = $1` {
		t.Fatal(sqlText)
	}
}
