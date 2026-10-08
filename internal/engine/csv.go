package engine

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
)

func ExportCSV(ctx context.Context, db *sql.DB, req PageRequest) (string, bool, error) {
	req.Limit = 100000
	req.Offset = 0
	page, err := PageQuery(ctx, db, req)
	if err != nil {
		return "", false, err
	}
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write(page.Columns); err != nil {
		return "", false, err
	}
	for _, row := range page.Rows {
		record := make([]string, len(row))
		for i, cell := range row {
			if cell == nil {
				continue
			}
			record[i] = fmt.Sprint(cell)
		}
		if err := writer.Write(record); err != nil {
			return "", false, err
		}
	}
	writer.Flush()
	return buf.String(), len(page.Rows) >= 100000, writer.Error()
}
