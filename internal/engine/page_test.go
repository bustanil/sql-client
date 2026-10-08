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
