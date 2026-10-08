# SQL Client — Vertical slices

Status: the v1 build order  
Specs: [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md)

Each slice is one user-visible path through Electron, React, and Go. Finish a slice before starting the next. A slice is done when its checks pass on PostgreSQL and MySQL, unless a check names one engine.

The UI for these screens is in [mocks/index.html](mocks/index.html).

## Order

| Slice | User can | Done-when item |
| --- | --- | --- |
| [S1 Boot](#s1--boot) | Open the app and see that the database process is up | — |
| [S2 Connections](#s2--connections) | Save, test, and delete a connection | 1 |
| [S3 Connect](#s3--connect) | Open and close a workspace | 1 |
| [S4 Explorer](#s4--explorer) | Expand the schema tree | 2 |
| [S5 Rows](#s5--rows) | Open a table and page through it | 5, paging only |
| [S6 Narrow](#s6--narrow) | Filter, sort, hide columns, count | 5 |
| [S7 Query](#s7--query) | Run SQL and see rows or an error | 6, except cancel |
| [S8 Control](#s8--control) | Cancel, time out, and reopen history | 6 |
| [S9 Create](#s9--create) | Create a database and a table from forms | 3 |
| [S10 Drop](#s10--drop) | Drop and alter columns, with confirmation | 4 |
| [S11 Read-only](#s11--read-only) | Browse and select, and be refused on a write | 7 |
| [S12 Indexes](#s12--indexes) | Create and drop an index | 8 |
| [S13 Foreign keys](#s13--foreign-keys) | Create and drop a foreign key | 8 |
| [S14 Export](#s14--export) | Save the current grid as CSV | 9 |
| [S15 Complete](#s15--complete) | Accept table and column suggestions | 10 |
| [S16 Package](#s16--package) | Launch a built Mac app | — |

## S1 — Boot

The window opens, React can call Go, and a request without the launch secret is rejected.

**Done when**

- `npm` starts Vite and `go run` starts the server. React shows the empty connection screen against that server.
- Electron starts Go, reads the ready line, and loads the same screen.
- `GET /health` with the bearer secret returns ok. Without it, Go returns 401.
- Go listens on `127.0.0.1` only.

**Build**

- Go: HTTP server, launch secret, `/health`.
- React: Vite shell and one API client that sends the secret.
- Electron: generate the secret, spawn Go, pass the origin and secret through preload.

## S2 — Connections

A connection can be saved and tested. The password is not in the connection file.

**Done when**

- The list shows name, user, host, port, database, engine, TLS, and the read-only badge.
- New, edit, and duplicate work. The port becomes 5432 or 3306 when the engine changes, until the user types a port.
- Test runs `SELECT 1` and shows success or the server error. It does not save. A dead host fails by 10 seconds.
- Save writes `connections.json` with no password field. Electron stores the password in the keychain under the connection id.
- Delete removes the file record and the keychain item, and asks first. Nothing is dropped on the server.
- Names are unique.

**Build**

- Go: connection store and `POST /connections/test`.
- React: the connection list and the form from the mock.
- Electron: keychain get, set, and delete.

## S3 — Connect

Connect opens the workspace. Disconnect returns to the list.

**Done when**

- Connect creates an explorer session and shows the connection name, engine, database, and Idle in the status line.
- A wrong password shows the server's authentication error. The workspace does not open.
- Disconnect closes that session and its tabs. The list is shown again.
- PostgreSQL with an empty database connects to the maintenance database. MySQL connects with no default database.

**Build**

- Go: `POST /sessions` and `DELETE /sessions/{id}` for `role: explorer`. 10 second dial timeout.
- React: Connect on a row, the workspace frame, Disconnect.
- Electron: read the keychain password and hand it to Go for this call only.

## S4 — Explorer

The open connection is a tree. Children load on expand.

**Done when**

- The root is the connection. PostgreSQL is database, schema, Tables, Views. MySQL has no schema level.
- Columns show name, type, nullability, and primary key. `pg_catalog`, `information_schema`, and the MySQL system databases stay hidden until the toggle.
- The search box filters names already loaded. Refresh reloads the selected node's children.
- Clicking a database makes it current. PostgreSQL opens a new connection and keeps the same session id. MySQL runs `USE`.
- Right-click and the toolbar offer the same actions. This slice includes Refresh and Set current database. Later slices add the rest and enable them.
- An empty database or schema shows its node and does not show an error.

**Build**

- Go: catalog routes, `system=1`, and `POST /sessions/{id}/database`.
- React: explorer rows, icons, context menu, toolbar, filter.

## S5 — Rows

Opening a table or view shows a read-only page of rows.

**Done when**

- Open data, from the menu, the toolbar, or a double-click, opens a tab named for that relation.
- The grid shows the first 100 rows. `NULL` is the label NULL, not a blank cell. Page size can be 50, 100, or 500.
- Previous and Next change the window label, for example `101–200`. The statement panel shows the SQL with placeholders.
- The explorer stays usable while this tab is open.

**Build**

- Go: `POST /sessions/{id}/browse` with columns, limit, and offset. No filters yet.
- React: the data tab, grid, pager, and statement panel.

## S6 — Narrow

The same grid can filter, sort, hide columns, and count.

**Done when**

- One or more filters combine with AND. Apply runs the query. Typing does not. Clear reloads the first page.
- Contains is case-insensitive on PostgreSQL and follows the column collation on MySQL. Is empty and is not empty send no value.
- One column header cycles unsorted, ascending, descending. Hiding a column removes it from the SELECT list. At least one column stays visible. Hiding a filtered column removes that filter.
- Count runs a separate request and shows the number. It does not run on Apply.
- Values are parameters. The statement panel matches the page.

**Build**

- Go: filters, sort, and `POST /sessions/{id}/browse/count` on the explorer session.
- React: filter builder, chips, column picker, sort headers, Count.

## S7 — Query

A query tab runs SQL on its own session and shows rows or the server error.

**Done when**

- New query opens a tab bound to the current connection and database. The editor highlights keywords, strings, numbers, and comments. Format rewrites clause layout and keyword case without changing strings or identifiers.
- Cmd+Enter runs the selection, or the statement around the cursor when nothing is selected.
- A row-returning statement shows the first 1,000 rows, or 5,000 when that cap is chosen, and says when the cap cut the result off. Other successes show rows affected, or Done, plus elapsed time.
- An invalid statement shows the server message. When the server returns a position, the cursor moves there.
- The explorer still loads while this query runs.

**Build**

- Go: query sessions, `POST /sessions/{id}/queries` through the result line, `maxRows`. Read-only rejection waits for S11.
- React: CodeMirror, Format, Run, the result grid, and the error panel.

## S8 — Control

A running statement can be stopped, and past statements can be reopened.

**Done when**

- The tab times out at 30 seconds unless the user picks 15s, 60s, 5 minutes, or none.
- Cancel, and disconnecting the request, both stop the statement. The tab shows Canceled.
- Several statements run in order and stop at the first error. The grid keeps the last row-returning result. Each statement gets a message line.
- History keeps the last 100 statements per connection, without result rows. Opening an entry copies the text into a new query tab.
- Changing the tab's database follows the S4 switch rule and keeps the editor text.

**Build**

- Go: timeout, cancel route, multi-statement stop, history file, database switch on query sessions.
- React: timeout control, Cancel, history popover, database control.

## S9 — Create

A form can create a database and a table after showing the SQL.

**Done when**

- Create database and Create table are on the menu and the toolbar for the right nodes.
- Each form shows one statement. Editing the form replaces it until the user edits the statement. Reset from form restores it. Run executes the text in the box.
- Create table supports the type list in the product spec, one identity or auto-increment column, and one primary key. At least one named column is required.
- On success the form closes and the new object is in the tree. On failure the form stays open and shows the server error.

**Build**

- Go: `POST /sessions/{id}/ddl/preview` for `createDatabase` and `createTable`, and `POST /sessions/{id}/execute`.
- React: both forms, the SQL preview, and tree refresh.

## S10 — Drop

Drops and column changes require confirmation, then the tree updates.

**Done when**

- Drop database, drop table, drop view, and drop column stay disabled until the typed name matches.
- Add column previews `ALTER TABLE … ADD COLUMN` and refreshes that table's columns. Dropping the last column is refused before execution.
- In the editor, a statement whose first keyword is `DROP`, `TRUNCATE`, or `ALTER` asks for a yes/no confirmation that names the verb.
- After a drop, the object is gone from the tree. Dropping the current database switches off it first, and does not run if that switch fails.

**Build**

- Go: preview for the remaining DDL actions, last-column refusal, and the current-database switch inside drop database.
- React: typed confirmation, add-column form, and the editor confirmation.

## S11 — Read-only

A read-only connection can look and select. It cannot change structure or write.

**Done when**

- The flag saved in S2 hides create and drop actions in the menu and toolbar.
- `SELECT`, `WITH … SELECT`, `SHOW`, `EXPLAIN`, and `VALUES` run. `DROP` and `INSERT` are rejected before they are sent, with the reason named.
- Go also sets the session read-only where the engine allows it.
- Browse and the explorer still work.

**Build**

- Go: the read check and the server read-only setting on session open.
- React: hide the mutating actions that exist. Show the rejection in the editor. S12 and S13 hide index and foreign-key actions on a read-only connection.

## S12 — Indexes

A table can gain and lose an index through the same form-then-SQL path as create table.

**Done when**

- Each table has an Indexes folder. An index row lists its columns in order.
- Create index asks for a name, a unique flag, and at least one column. The preview is `CREATE INDEX` or `CREATE UNIQUE INDEX`. Run adds it to the tree.
- Drop index stays disabled until the typed name matches. PostgreSQL runs `DROP INDEX`. MySQL runs `DROP INDEX … ON table`.
- A read-only connection hides both actions.
- Partial indexes, expressions, and included columns are not offered.

**Build**

- Go: catalog of indexes, and preview actions `createIndex` and `dropIndex`.
- React: the folder, the form, and the typed confirmation.

## S13 — Foreign keys

A table can reference another table in the same database.

**Done when**

- Each table has a Foreign keys folder. A row shows the local columns, the referenced table, and the referenced columns.
- Create asks for a constraint name, the local columns, a referenced table in the same database, the referenced columns, and `ON DELETE` and `ON UPDATE`. The choices are `NO ACTION`, `RESTRICT`, `CASCADE`, and `SET NULL`. The two column lists must be the same length.
- The preview is `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES …`. Run adds it under the table.
- Drop stays disabled until the typed constraint name matches. PostgreSQL runs `ALTER TABLE … DROP CONSTRAINT`. MySQL runs `ALTER TABLE … DROP FOREIGN KEY`.
- A read-only connection hides both actions. Cross-database foreign keys are not offered.

**Build**

- Go: catalog of foreign keys, and preview actions `createForeignKey` and `dropForeignKey`.
- React: the folder, the form, and the typed confirmation.

## S14 — Export

The current grid can be saved as CSV.

**Done when**

- Export on a data tab writes every matching row for the current filters, sort, and visible columns, up to 100,000 rows. The status line says when the file stops at that cap.
- Export on a query result writes the rows already in that grid and does not run the statement again.
- The first row is the column names. `NULL` is empty. Commas, quotes, and newlines are quoted, and a quote inside a value is doubled.
- Electron asks for a path before writing. A read-only connection can export.

**Build**

- Go: `POST /sessions/{id}/export` for a browse query, streaming CSV up to the cap.
- React: Export on both grids.
- Electron: the save dialog and the file write.

## S15 — Complete

The editor suggests names from the current database.

**Done when**

- After a letter, a dot, or an explicit shortcut, the editor offers keywords, schemas, tables, views, and columns.
- System schemas are absent. After a table or view name and a dot, the list is that relation's columns when the name matches.
- Suggestions follow the query tab's database, and they refresh after a database switch and after a successful DDL statement.
- Highlight and Format still work when the catalog has not loaded.

**Build**

- Go: `GET /sessions/{id}/complete` for the query session's current database.
- React: CodeMirror completion fed by that list.

## S16 — Package

A built Mac app launches without a separate Go or Vite process.

**Done when**

- The Electron build includes the Go binary for the Mac CPU it is built on.
- Opening the app shows the connection list, and a saved connection from a dev run is still there.
- Quit stops the Go process.

**Build**

- Go: a release binary with no Mac-only calls.
- Electron: package the binary, start it, and stop it on quit.

## Not in these slices

SSH tunnels, cell editing, and Windows or Linux builds stay on the later list in the product spec.
