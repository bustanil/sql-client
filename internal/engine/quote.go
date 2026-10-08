package engine

import "strings"

func Quote(engineName, ident string) string {
	if engineName == "MySQL" {
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}
