# SQL Client

A local Mac app for one person to connect to PostgreSQL and MySQL, browse the schema, change structure, inspect rows, and run SQL.

Electron owns the window and the macOS keychain. React draws the screen. A Go process, started by Electron, is the only process that opens a database connection. It listens on `127.0.0.1` and requires a per-launch bearer secret. Passwords stay in the keychain. The connection file has no password.

Engines: PostgreSQL 14–17 and MySQL 8.0 / 8.4. MariaDB is not a target. Connections are direct TCP, with TLS off, required, or verified. There is no SSH tunnel.

The product spec is [docs/PRODUCT.md](docs/PRODUCT.md). The process split and HTTP API are [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you can do

- Save, test, edit, duplicate, and delete connections. Mark one read-only.
- Browse databases, schemas, tables, views, columns, indexes, and foreign keys. The sidebar width is draggable. A cut-off name shows in full on hover.
- Create and drop a database or table from a form that shows the SQL before it runs. Create an index or foreign key by confirming the generated statement.
- Open a table or view. Filter with several conditions combined with AND, sort one column, hide columns, and page through rows. A hidden column can still be filtered.
- Select rows. Click another cell in the same row to move the cell highlight. Double-click the highlighted cell to copy its value.
- Export the filtered grid, the selected rows, or the rows already returned by a query, as CSV. The first line is the column names.
- Run SQL in its own session. The editor colors SQL, formats it, cancels a running statement, and suggests tables and columns.

A read-only connection hides create and drop, and rejects a statement that does not look like a read before it is sent.

## Requirements

- macOS
- Go 1.27.1
- Node.js 26

## Run it

```bash
npm install
npm --prefix web install
npm run dev
```

`npm run dev` compiles the Electron shell, starts the React dev server, and opens the window. Electron starts the Go process.

`npm run dev:ui` starts only the React server and Go, without a window. That path has no keychain.

## Package

```bash
npm run pack
```

This writes an unsigned app to `release/mac-arm64/SQL Client.app`.

```bash
npm run pack:dmg
```

This packs the app, ad-hoc signs it, and writes `release/sql-client-arm64.dmg`.

A push to `main`, a pull request, or a `v*` tag runs the same disk-image build on GitHub Actions and uploads `sql-client-arm64.dmg` plus its checksum. The signature is ad-hoc. It is not notarized.

## Test

```bash
go test ./...
npm --prefix web run build
```

The Go tests cover the catalog SQL, filters, DDL text, and the local HTTP API. They do not open a real PostgreSQL or MySQL server.

## Where data lives

`~/Library/Application Support/SQL Client/`

| Path | Contents |
| --- | --- |
| `connections.json` | Saved connections. No password. |
| `history/<connection-id>.json` | The last 100 statements for that connection. No result rows. |

Keychain ciphertext is under the Electron user-data directory, not in `connections.json`.

## Layout

| Path | What it is |
| --- | --- |
| `cmd/server` | Go process entry point |
| `internal/` | Sessions, catalog, browse, query, DDL, and the HTTP API |
| `web/` | React UI |
| `electron/` | Window, preload, and keychain |
| `scripts/` | Dev launchers and the disk-image step |
| `docs/` | Spec, architecture, and the original task list |
