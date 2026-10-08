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
