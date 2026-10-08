package engine

import "testing"

func TestIsReadRejectsWrites(t *testing.T) {
	if !IsRead("select 1") || !IsRead("WITH rows AS (select 1) select * from rows") {
		t.Fatal("reads should pass")
	}
	if IsRead("drop table users") || IsRead("insert into users values (1)") || IsRead("with x as (select 1) insert into t select * from x") {
		t.Fatal("writes should fail")
	}
}
