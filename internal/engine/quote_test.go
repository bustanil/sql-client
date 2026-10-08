package engine

import "testing"

func TestQuote(t *testing.T) {
	if got := Quote("PostgreSQL", `we"ird`); got != `"we""ird"` {
		t.Fatal(got)
	}
	if got := Quote("MySQL", "we`ird"); got != "`we``ird`" {
		t.Fatal(got)
	}
}
