# SQL Client — Architecture

Status: locked for v1  
Shell: Electron  
UI: React  
Database process: Go

Electron owns the window and the keychain. React owns the screen. Go is the only process that opens a database connection.

## Processes

```
Electron main
  ├─ BrowserWindow  →  React
  ├─ keychain (safeStorage)
  └─ spawn one Go process per app launch
        listen 127.0.0.1:<random port>
        require Authorization: Bearer <launch secret>
```

On startup the main process generates a 32-byte secret, starts Go, and passes the secret in the environment. Go prints one line when it is listening:

```json
{"ready":true,"port":53124}
```

The preload script exposes that origin and the secret to the renderer. The renderer sends the secret on every request. Go returns 401 for any other caller. The listener is `127.0.0.1` only.

During UI work, run Vite and `go run` directly. Electron is required for the window and the keychain.

## Who owns what

| Concern | Owner |
| --- | --- |
| Window, menus, quit | Electron main |
| Password storage | Electron keychain, keyed by connection id |
| Connection file | Go. No password field |
| Live database sessions | Go |
| Identifier quoting, catalog SQL, DDL SQL | Go |
| Read-only rejection, statement timeout, cancel | Go |
| Explorer, grids, forms, tabs | React |
| SQL highlight and Format | React (CodeMirror) |
| Query history text | Go, last 100 entries per connection. No result rows |

React sends structured actions (the create-table form, a browse request). Go returns SQL and results. The editor may change a DDL statement before Run. Go executes the text it is given.

## Sessions

A session is one database connection, held for the life of that part of the UI.

| Session | When it exists | Rule |
| --- | --- | --- |
| Explorer | While a saved connection is open | Catalog reads and DDL. Never shares a connection with a query tab. |
| Query tab | When the tab is created | One tab, one connection. A slow query stays on that connection. |

PostgreSQL binds a connection to one database. Switching database closes that connection and opens another. The session id stays the same. MySQL runs `USE` on the existing connection.

Connect and test fail at 10 seconds when the host does not answer. The statement timeout is the value selected on the query tab (15s, 30s, 60s, 5 minutes, or none). Cancel closes the HTTP request or calls the cancel endpoint. Go cancels the query context either way.

A read-only connection sets the server session read-only where the engine allows it, and Go rejects a statement that does not look like a read before it is sent.

## On disk

`~/Library/Application Support/SQL Client/`

| File | Contents |
| --- | --- |
| `connections.json` | Name, engine, host, port, user, database, TLS, read-only flag. No password. |
| `history/<connection-id>.json` | Last 100 statement texts, timestamp, database, duration, success or error message. |

The keychain item for a connection is deleted with the connection.

## API

Base URL is `http://127.0.0.1:<port>`. Every path below also requires the bearer secret. Bodies are JSON.

Errors are `{ "error": "<server or app message>" }` with a 4xx or 5xx status. Database errors keep the server's text.

### Connections

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/connections` | | Saved connections, no secrets |
| POST | `/connections` | Connection fields | Created record |
| PATCH | `/connections/{id}` | Changed fields | Updated record |
| DELETE | `/connections/{id}` | | Removes the file record. The renderer also deletes the keychain item |
| POST | `/connections/test` | Fields plus `password` | `{ "ok": true }` or the server error. Does not save |

`password` may be empty. Test runs `SELECT 1`.

### Sessions

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/sessions` | `{ "connectionId", "password", "role": "explorer" \| "query", "database" }` | `{ "sessionId", "engine", "database", "readOnly" }` |
| DELETE | `/sessions/{id}` | | Closes the connection |
| POST | `/sessions/{id}/database` | `{ "database" }` | Switches database as described above |

Opening a saved connection creates the explorer session. Each new query tab creates a query session. Disconnect deletes all sessions for that connection.

### Catalog

Children load when a node expands.

| Method | Path | Query |
| --- | --- | --- |
| GET | `/sessions/{id}/databases` | |
| GET | `/sessions/{id}/schemas` | `database` |
| GET | `/sessions/{id}/tables` | `database`, `schema` (PostgreSQL) |
| GET | `/sessions/{id}/views` | `database`, `schema` |
| GET | `/sessions/{id}/columns` | `database`, `schema`, `table` |
| GET | `/sessions/{id}/indexes` | `database`, `schema`, `table` |
| GET | `/sessions/{id}/foreign-keys` | `database`, `schema`, `table` |
| GET | `/sessions/{id}/definition` | `database`, `schema`, `name`, `kind=table\|view` |
| GET | `/sessions/{id}/complete` | Names for the query session's current database: schemas, tables, views, and columns. System schemas are omitted. |

System schemas stay out of these lists unless the query includes `system=1`.

Column objects are `{ "name", "type", "nullable", "default", "primaryKey" }`.

### Browse

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions/{id}/browse` | One page of a table or view |
| POST | `/sessions/{id}/browse/count` | `COUNT(*)` with the same filters and no sort |

Browse body:

```json
{
  "database": "app_dev",
  "schema": "public",
  "relation": "users",
  "kind": "table",
  "columns": ["id", "email"],
  "filters": [{ "column": "email", "op": "contains", "value": "ada" }],
  "sort": { "column": "created_at", "dir": "desc" },
  "limit": 100,
  "offset": 0
}
```

`schema` is omitted for MySQL. Filter ops are `eq`, `neq`, `contains`, `gt`, `lt`, `empty`, `notempty`. Values are bound as parameters. The response includes `sql` for the read-only statement panel, with placeholders, plus `columns`, `rows`, and `window` (`{ "start", "end" }`). `rows` use `null` for SQL NULL.

`limit` is 50, 100, or 500.

`POST /sessions/{id}/export` takes the same body as browse and streams CSV for the filtered rows, visible columns, and sort. It stops at 100,000 data rows. Query-result export uses the rows already returned and does not call this route.

### DDL

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions/{id}/ddl/preview` | Build one statement from the form |
| POST | `/sessions/{id}/execute` | Run the statement text, including edits |

Preview `action` is `createDatabase`, `dropDatabase`, `createTable`, `dropTable`, `dropView`, `addColumn`, `dropColumn`, `createIndex`, `dropIndex`, `createForeignKey`, or `dropForeignKey`. The body carries the form fields from the product spec. The response is `{ "sql" }`.

Execute body is `{ "sql" }`. A read-only session rejects a write before it is sent. The UI still asks the user to type the object name before a drop, and to confirm an editor statement whose first keyword is `DROP`, `TRUNCATE`, or `ALTER`.

### Queries

`POST /sessions/{id}/queries` blocks until the statement finishes. The response is newline-delimited JSON. The first line is sent immediately so the UI can cancel:

```json
{"type":"started","queryId":"q_01"}
{"type":"result","columns":[],"rows":[],"rowsAffected":4,"truncated":false,"elapsedMs":18,"messages":["4 rows · 18 ms"]}
```

A failure line is `{ "type": "error", "message", "position" }`. A cancel line is `{ "type": "canceled" }`.

Request body:

```json
{ "sql": "select 1", "timeoutSec": 30, "maxRows": 1000 }
```

`timeoutSec` of `0` means no timeout. `maxRows` is 1000 or 5000.

`POST /sessions/{id}/queries/{queryId}/cancel` cancels that query. Disconnecting the original POST cancels it as well.

Several statements in the submitted text run in order on that session and stop at the first error. The result grid is the last statement that returned rows. `messages` has one line per statement.

Go appends the history entry when the query finishes.

### History

| Method | Path | Result |
| --- | --- | --- |
| GET | `/connections/{id}/history` | Newest first, at most 100 |

## Repo layout

```
cmd/server/          Go process main
internal/httpapi/    routes and the launch secret
internal/session/    one connection per session
internal/engine/     postgres and mysql quote, catalog, DDL, read-only
internal/store/      connections.json and history
web/                 Vite + React + CodeMirror
electron/            main and preload
```

Drivers for v1 are `pgx` and `go-sql-driver/mysql`. There is no ORM. Each session holds a dedicated connection, not a connection borrowed from a shared pool.

## Packaging

The Electron build includes the Go binary for the current OS and CPU. v1 ships macOS. The Go code stays free of Mac-only calls so a later Windows or Linux build is a new binary plus the Electron target, not a rewrite.

The build order is sixteen vertical slices in [TASKS.md](TASKS.md).
