package engine

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type cellKind int

const (
	cellNull cellKind = iota
	cellString
	cellBool
	cellNumber
)

// Cell is one SQL value shown in a grid: null, text, a boolean, or a JSON number.
type Cell struct {
	kind    cellKind
	text    string
	boolean bool
	raw     string
}

func (c *Cell) Scan(src interface{}) error {
	*c = cellFrom(src)
	return nil
}

func (c Cell) Null() bool { return c.kind == cellNull }

func (c Cell) Text() string {
	switch c.kind {
	case cellString:
		return c.text
	case cellBool:
		if c.boolean {
			return "true"
		}
		return "false"
	case cellNumber:
		return c.raw
	default:
		return ""
	}
}

func (c Cell) MarshalJSON() ([]byte, error) {
	switch c.kind {
	case cellString:
		return json.Marshal(c.text)
	case cellBool:
		return json.Marshal(c.boolean)
	case cellNumber:
		return []byte(c.raw), nil
	default:
		return []byte("null"), nil
	}
}

func cellFrom(src interface{}) Cell {
	switch v := src.(type) {
	case nil:
		return Cell{}
	case string:
		return Cell{kind: cellString, text: v}
	case []byte:
		return Cell{kind: cellString, text: string(v)}
	case bool:
		return Cell{kind: cellBool, boolean: v}
	case time.Time:
		return Cell{kind: cellString, text: v.Format(time.RFC3339Nano)}
	case int:
		return Cell{kind: cellNumber, raw: strconv.Itoa(v)}
	case int8:
		return Cell{kind: cellNumber, raw: strconv.FormatInt(int64(v), 10)}
	case int16:
		return Cell{kind: cellNumber, raw: strconv.FormatInt(int64(v), 10)}
	case int32:
		return Cell{kind: cellNumber, raw: strconv.FormatInt(int64(v), 10)}
	case int64:
		return Cell{kind: cellNumber, raw: strconv.FormatInt(v, 10)}
	case uint:
		return Cell{kind: cellNumber, raw: strconv.FormatUint(uint64(v), 10)}
	case uint8:
		return Cell{kind: cellNumber, raw: strconv.FormatUint(uint64(v), 10)}
	case uint16:
		return Cell{kind: cellNumber, raw: strconv.FormatUint(uint64(v), 10)}
	case uint32:
		return Cell{kind: cellNumber, raw: strconv.FormatUint(uint64(v), 10)}
	case uint64:
		return Cell{kind: cellNumber, raw: strconv.FormatUint(v, 10)}
	case float32:
		return numberCell(float64(v))
	case float64:
		return numberCell(v)
	case json.Number:
		return Cell{kind: cellNumber, raw: v.String()}
	default:
		return Cell{kind: cellString, text: fmt.Sprint(v)}
	}
}

func numberCell(v float64) Cell {
	raw, err := json.Marshal(v)
	if err != nil {
		return Cell{kind: cellString, text: fmt.Sprint(v)}
	}
	return Cell{kind: cellNumber, raw: string(raw)}
}

func scanCells(rows *sql.Rows, width, limit int) ([][]Cell, bool, error) {
	out := [][]Cell{}
	truncated := false
	for rows.Next() {
		if limit > 0 && len(out) >= limit {
			truncated = true
			break
		}
		row := make([]Cell, width)
		ptrs := make([]interface{}, width)
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, false, err
		}
		out = append(out, row)
	}
	return out, truncated, rows.Err()
}
