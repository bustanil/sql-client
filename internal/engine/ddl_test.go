package engine

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCreateTableQuotesAndPrimaryKey(t *testing.T) {
	raw := json.RawMessage(`{
	  "action":"createTable",
	  "name":"invoices",
	  "schema":"public",
	  "columns":[
	    {"name":"id","type":"bigint generated always as identity","primaryKey":true},
	    {"name":"total","type":"numeric(12, 2)","nullable":false}
	  ]
	}`)
	sqlText, err := Preview("PostgreSQL", raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqlText, `CREATE TABLE "public"."invoices"`) || !strings.Contains(sqlText, `PRIMARY KEY ("id")`) {
		t.Fatal(sqlText)
	}
}

func TestMySQLDropIndexUsesTable(t *testing.T) {
	raw := json.RawMessage(`{"action":"dropIndex","name":"users_email","table":"users"}`)
	sqlText, err := Preview("MySQL", raw)
	if err != nil {
		t.Fatal(err)
	}
	if sqlText != "DROP INDEX `users_email` ON `users`" {
		t.Fatal(sqlText)
	}
}
