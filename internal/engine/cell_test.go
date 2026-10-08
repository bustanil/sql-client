package engine

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCellJSON(t *testing.T) {
	stamp := time.Date(2026, 10, 8, 2, 0, 0, 0, time.UTC)
	cases := []struct {
		in   interface{}
		want string
	}{
		{nil, "null"},
		{"ada", `"ada"`},
		{[]byte("ada"), `"ada"`},
		{true, "true"},
		{int64(42), "42"},
		{float64(1.5), "1.5"},
		{stamp, `"2026-10-08T02:00:00Z"`},
	}
	for _, tc := range cases {
		var cell Cell
		if err := cell.Scan(tc.in); err != nil {
			t.Fatal(err)
		}
		got, err := json.Marshal(cell)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != tc.want {
			t.Fatalf("Scan(%v) JSON %s, want %s", tc.in, got, tc.want)
		}
	}
}
