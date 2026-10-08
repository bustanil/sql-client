# SQL Client — Product Spec

Status: draft  
Version: 0.1  
Engines: PostgreSQL 14–17, MySQL 8.0 and 8.4

A local application for one person to connect to PostgreSQL and MySQL, browse schema, change structure, inspect rows, and run SQL.

## Decisions locked for v1

These are defaults so building can start. Change them before implementation if they are wrong.

| Decision | v1 choice | Why |
| --- | --- | --- |
| Where it runs | On the user's machine. Not a hosted service. | Databases are private. Passwords and query results stay local. |
| Who it's for | One person on one computer. No accounts, no sync. | Connection management is a local list, not a team directory. |
| First OS | macOS. Structure the app so Windows and Linux are not a rewrite. | This is the machine it will be used on first. |
| Data grid | Read-only. Filter, sort, and choose columns. No cell editing. | The request is to browse data, not to edit it. |
| DDL | A form builds SQL. The user sees the statement, can edit it, then runs it. | Structure changes should be visible before they hit the server. |
| Reachability | Direct TCP, with TLS options. No SSH tunnel. | Tunnels are a separate connection mode. Ship direct connections first. |
| Engines | PostgreSQL and MySQL only. MariaDB is not a named target. | Two engines, tested on the versions above. |
| Shell | Electron. | Mac window, menus, and the OS keychain. |
| UI | React. | Explorer, tabs, grids, forms, and the SQL editor. |
| Database process | A Go server started by Electron. | Go is the only process that opens a database connection. |

The process split, sessions, and HTTP API are in [ARCHITECTURE.md](ARCHITECTURE.md). The build order is in [TASKS.md](TASKS.md).

## Who it's for

A developer working against a local or remote PostgreSQL or MySQL database during development. They already know SQL. They want one window for connections, schema, structure changes, row inspection, and ad hoc queries.

Not the target: a BI analyst building dashboards, or a DBA managing users, replication, and backups.

## Goals

1. Save a connection once and reopen it without retyping the password.
2. See databases, schemas, tables, views, and columns.
3. Create and drop databases and tables, and add or drop columns, without writing the SQL by hand first.
4. Open a table and narrow what is on screen: filter, sort, hide columns, page through rows.
5. Run SQL and see rows, a row count, or the server error.
6. Create and drop indexes and foreign keys from forms that show the SQL.
7. Export the current grid as CSV.
8. Complete table, view, and column names in the editor.

## Non-goals for v1

- Other databases (SQLite, SQL Server, Oracle, MongoDB).
- SSH bastions, HTTP proxies, or cloud identity (IAM, SSO).
- Editing cell values, or importing CSV.
- Checks, views-as-editors, functions, triggers, users, and grants.
- `EXPLAIN` plans, ER diagrams, query sharing, and AI completion.
- A Windows or Linux build. The design must not block one later.

## Workspace

After a connection opens, the window has three regions:

1. **Object explorer** on the left. The open connection is the root. Databases, schemas, tables, views, and columns hang under it, with a disclosure triangle and a type icon on each row.
2. **Toolbar and tabs** in the center. The toolbar acts on the selected object. A tab is either a data grid, a DDL form, or a SQL editor.
3. **Status line** under the active tab. Connection name, engine, current database, and whether a statement is running.

The object tree uses its own database session. A running editor query does not freeze the tree. Each editor tab has its own session, so one slow query does not block another tab.

Closing the connection closes its tabs after confirming if a query is still running.

## 1. Connections

### What the user can do

- Add, edit, duplicate, and delete a saved connection.
- Test a connection before saving it.
- Connect and disconnect.
- Mark a connection read-only.

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| Name | Yes | Display label. Unique in the local list. |
| Engine | Yes | `PostgreSQL` or `MySQL`. |
| Host | Yes | Hostname or IP. |
| Port | Yes | Defaults to 5432 or 3306 when the engine changes, unless the user has typed a port. |
| Username | Yes | |
| Password | No | Empty is allowed. Stored in the OS keychain, never in the connection file. |
| Database | No | Database selected on connect. If empty, PostgreSQL connects to the maintenance database (`postgres` if it exists, otherwise the username). MySQL connects with no default database. |
| TLS | Yes | `Off`, `Require` (encrypt, do not verify the certificate), or `Verify` (encrypt and verify). |
| Read-only | Yes | Default off. |

### Behavior

- **Test** opens a session, runs a trivial query (`SELECT 1`), and shows success or the server's error text. It does not save.
- Test and connect fail visibly within 10 seconds if the host does not answer.
- The saved record on disk contains everything except the password. A keychain lookup failure on connect asks for the password again and offers to store it.
- Delete asks for confirmation. It removes the record and the keychain item. It does not drop anything on the server.
- Duplicate copies the record, appends " copy" to the name, and shares no password until the user saves one.
- A wrong password shows the server's authentication error.

### Read-only

When the flag is on:

- DDL actions in the tree are hidden.
- Before sending editor SQL, the app rejects the statement if it does not look like a read (`SELECT`, `WITH … SELECT`, `SHOW`, `EXPLAIN`, or `VALUES`). The rejection names the reason. This check is best-effort.
- The session is also set read-only on the server where the engine allows it (PostgreSQL `default_transaction_read_only`; MySQL `SET SESSION TRANSACTION READ ONLY` for the next transaction).

## 2. Object browser

### Tree

PostgreSQL:

```
connection
  database
    schema
      Tables
        table
          column  type  nullability  default  key
          Indexes
            index
          Foreign keys
            foreign key
      Views
        view
```

Indexes and foreign keys hang under the table they belong to. MySQL has no schema level. A database contains `Tables` and `Views` directly, and each table still contains its indexes and foreign keys.

- Children load when the node expands, not at connect time.
- The tree lists objects the connected user can see. It does not try to list databases the user cannot access.
- PostgreSQL hides `pg_catalog` and `information_schema` from the schema list. A toggle shows them.
- MySQL hides `mysql`, `information_schema`, `performance_schema`, and `sys` unless that toggle is on.

### Actions

The same actions are available in two places: a right-click context menu on the object, and the toolbar, which follows the selection. Read-only connections omit every action that changes structure.

| Action | Where | Result |
| --- | --- | --- |
| Refresh | Connection, database, schema, or folder | Reloads that node's children. |
| Filter | Explorer search box | Case-insensitive substring on the names already loaded. Does not search the server. |
| Open data | Table or view. Also double-click. | Opens a data-grid tab. |
| Show definition | Table or view | Opens a read-only SQL tab with the server's definition. |
| Create database | Connection | Opens the create-database form. |
| Create table | Database (MySQL) or schema (PostgreSQL) | Opens the create-table form. |
| Drop | Database, table, view, column, index, or foreign key | Confirmation, then the drop flow. |
| Create index | Table | Opens the create-index form. |
| Create foreign key | Table | Opens the create-foreign-key form. |
| Export CSV | Data grid or query result | Writes a CSV file. |
| Set current database | Click a database | Later editor tabs and DDL forms use it. PostgreSQL opens a new session, because a session is tied to one database. MySQL runs `USE`. |

Column rows show name, data type, nullable or not, default, and whether the column is in the primary key. They are not separate tabs.

An empty schema or database shows the tree node and a **Create table** action. It does not show an error.

## 3. DDL

Every DDL action follows the same path: form, SQL preview, run, refresh.

1. The form collects the fields below.
2. The app generates a single statement and shows it in an editable SQL view.
3. **Run** executes that text, including any edits. **Cancel** closes the form and changes nothing.
4. On success, the tree refreshes the affected node and the form closes.
5. On failure, the form stays open and shows the server error.

The app quotes identifiers with the engine's rules (PostgreSQL double quotes, MySQL backticks). The user can edit the preview, so a hand-edited statement can still fail server-side.

### Create database

| Field | PostgreSQL | MySQL |
| --- | --- | --- |
| Name | Required. Max 63 bytes. | Required. Max 64 characters. |
| Defaults applied, not shown | Encoding `UTF8`, locale from the template database. | Character set `utf8mb4`, collation `utf8mb4_0900_ai_ci`. |

### Drop database

- The user must type the database name to enable **Drop**.
- The statement is `DROP DATABASE`.
- If it is the session's current database, the app switches to the maintenance database (PostgreSQL) or clears the current database (MySQL) before dropping. If that switch fails, the drop does not run.

### Create table

| Field | Rule |
| --- | --- |
| Database / schema | PostgreSQL: schema, default `public`, in the current database. MySQL: current database. The user must pick a database first if none is current. |
| Table name | Required. Same length limits as database names. |
| Columns | At least one. Each column has name, type, nullability, default, and a primary-key checkbox. |

Type choices:

| PostgreSQL | MySQL |
| --- | --- |
| `smallint`, `integer`, `bigint` | `smallint`, `int`, `bigint` |
| `integer GENERATED ALWAYS AS IDENTITY`, `bigint GENERATED ALWAYS AS IDENTITY` | `int AUTO_INCREMENT`, `bigint AUTO_INCREMENT` |
| `numeric(p, s)` | `decimal(p, s)` |
| `text`, `varchar(n)` | `varchar(n)`, `text` |
| `boolean` | `boolean` |
| `date`, `timestamp`, `timestamptz` | `date`, `datetime`, `timestamp` |
| `uuid` | — |
| `json`, `jsonb` | `json` |
| Other: a raw type string | Other: a raw type string |

- `varchar` requires a length from 1 to 65535 on MySQL and 1 to 10485760 on PostgreSQL.
- `numeric` / `decimal` require precision and scale, precision ≥ scale, precision from 1 to 38.
- At most one `IDENTITY` or `AUTO_INCREMENT` column.
- An identity or auto-increment column is `NOT NULL` and part of the primary key.
- Checked primary-key columns become one `PRIMARY KEY (…)` in list order.
- Default is optional free text inserted verbatim into the statement (for example `0` or `'active'`). Empty means no `DEFAULT` clause.
- Nullable is on by default, off when the column is a primary key.

### Drop table

- The user must type the table name to enable **Drop**.
- The statement is `DROP TABLE`, schema-qualified on PostgreSQL.
- Views use a separate **Drop view** action with the same confirmation and `DROP VIEW`.

### Add column

Opened from a table. Fields match one create-table column, except primary key is not offered here. Identity / auto-increment is not offered here. Success refreshes that table's columns.

### Drop column

The user must type the column name. The statement is `ALTER TABLE … DROP COLUMN`. Dropping the last column is refused by the app before execution, because a table with zero columns is not a useful end state in either engine's normal workflow (PostgreSQL rejects it; MySQL can leave a broken table).

### Create index

Opened from a table. Fields are the index name, a unique checkbox, and one or more columns in order. The statement is `CREATE INDEX` or `CREATE UNIQUE INDEX` on that table. Partial indexes, expressions, and included columns are out of this version. Success adds the index under that table.

### Drop index

The user must type the index name. PostgreSQL uses `DROP INDEX`. MySQL uses `DROP INDEX … ON table`.

### Create foreign key

Opened from a table. Fields are the constraint name, the local columns, the referenced table in the same database, the referenced columns, and `ON DELETE` and `ON UPDATE`. The action choices are `NO ACTION`, `RESTRICT`, `CASCADE`, and `SET NULL`. The local and referenced column lists must be the same length. The statement is `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES …`. Cross-database foreign keys are out of this version.

### Drop foreign key

The user must type the constraint name. PostgreSQL uses `ALTER TABLE … DROP CONSTRAINT`. MySQL uses `ALTER TABLE … DROP FOREIGN KEY`.

### Not in v1

Rename, change type, `CREATE VIEW`, `TRUNCATE` from a form. `TRUNCATE` typed into the editor still runs, with the confirmation in [Safety](#safety).

## 4. Data browser

Opening a table or view shows a read-only grid.

### Columns

- All columns start visible, in catalog order.
- A column picker toggles visibility. At least one column stays visible.
- Hiding a column removes it from the `SELECT` list. It is not a client-side hide of fetched data.

### Sort

- One sort column.
- Clicking a header cycles: unsorted → ascending → descending → unsorted.
- Sorting replaces the previous sort.

### Filter

- The user adds zero or more filters. Each filter is a column, an operator, and a value when the operator needs one.
- Operators: equals, not equals, contains, greater than, less than, is empty, is not empty.
- **Is empty** and **is not empty** take no value (`IS NULL`, `IS NOT NULL`).
- Filters combine with `AND`.
- **Apply** runs the query. Typing does not.
- **Clear** removes filters and reloads the first page.
- Values are bound as parameters. They are not concatenated into SQL text.
- **Contains** is case-insensitive on PostgreSQL (`ILIKE`). On MySQL it uses `LIKE` and follows the column collation.
- A filter on a hidden column is invalid; hiding a filtered column removes that filter.

### Pages

- Page size defaults to 100. Choices: 50, 100, 500.
- Controls: previous, next. The label is the window, for example `101–200`, not a total.
- There is no page-number jump.
- **Count** runs a separate `COUNT(*)` with the same filters and no sort, and shows the number. It does not run automatically.
- The statement that produced the page is visible and read-only.

### Cells

- `NULL` renders as the label `NULL`, distinct from an empty string.
- Text longer than 200 characters is truncated in the cell. Expanding the row shows the full value.
- Binary values render as their byte length, not as raw bytes.

The grid does not update cells, delete rows, or insert rows.

### Export

**Export CSV** on a data tab writes every row that matches the current filters, sort, and visible columns, not only the page on screen. The file stops at 100,000 rows and the status line says when that cap is hit. **Export CSV** on a query result writes the rows already in that grid and does not run the statement again. The first row is the column names. SQL `NULL` is an empty field. A value that contains a comma, a quote, or a newline is quoted, and quotes inside it are doubled. Electron asks where to save the file.

## 5. SQL editor

### Tabs

- **New query** opens a tab bound to the current connection and current database.
- The user can change the tab's database. PostgreSQL opens a new session for that database. MySQL runs `USE`. Unsaved editor text is kept.
- Tabs show a fixed title (`Query 1`, `Query 2`) until the user renames one. Names are local to the window.

### Run

- The editor highlights keywords, strings, numbers, and comments.
- **Format** rewrites the editor text: clause keywords on their own lines, uppercase keywords, select lists broken on commas. It does not change identifiers, strings, or the meaning of the statement.
- Shortcut: Cmd+Enter on macOS.
- With a selection, the selection is the statement.
- With no selection, the statement is the text around the cursor, split on semicolons that are not inside quotes.
- Several statements in a selection run in order on that tab's session. The app stops at the first error. Each statement gets a one-line outcome. If a statement returns rows, its grid replaces the previous grid. The last row-returning result stays on screen.
- A statement still running disables **Run** and enables **Cancel**. Cancel asks the driver to abort. The tab shows `Canceled` if the server stops the query, or the server error if it does not.

### Results

- A row-returning statement shows a grid of the first 1,000 rows and the elapsed time. If the cap is hit, the grid says the result was truncated. The cap choices are 1,000 and 5,000.
- Any other successful statement shows `N rows affected` when the server reports a count, otherwise `Done`, plus elapsed time.
- A failure shows the server message. When the server returns a character position, the editor moves the cursor there.
- Grids in the editor are read-only and do not offer the data browser's filter builder. Sort and filter happen in SQL.

### Timeout

Default 30 seconds, per tab. Choices: 15 seconds, 30 seconds, 60 seconds, 5 minutes, no timeout. The timeout is a server-side statement timeout when the engine supports it, and a client-side abort as a backstop.

### History

- Each successful or failed execution appends the statement text, timestamp, connection name, database, duration, and success or the error message.
- History keeps the last 100 entries per connection, newest first.
- Opening an entry copies the text into a new editor tab. History does not store result rows.
- History is local. It is not sent anywhere.

Completion uses the query tab's current database. It suggests keywords, schemas, tables, views, and columns, and it leaves out system schemas. After a table or view name and a dot, it suggests that relation's columns. Names refresh when the tab's database changes and after a DDL statement succeeds. Highlighting and Format do not wait on the catalog.

## Engine differences that the product must absorb

| Topic | PostgreSQL | MySQL |
| --- | --- | --- |
| Namespace | Database → schema → table. Default schema `public`. | Database → table. |
| Switching database | New session. | `USE`. |
| Identifier quotes | Double quotes. Unquoted names fold to lowercase. | Backticks. Unquoted names follow the server's lower-case-table-names setting. The app always quotes. |
| Identity | `GENERATED ALWAYS AS IDENTITY`. | `AUTO_INCREMENT`. |
| Boolean | Real `boolean`. | `boolean` is `tinyint(1)`. Display `0` / `1` as returned. |
| Case-insensitive contains | `ILIKE`. | `LIKE` under the column collation. |
| Definition | Table: reconstruct columns from the catalog. View: `pg_get_viewdef`. | `SHOW CREATE TABLE` / `SHOW CREATE VIEW`. |
| Read-only session | `default_transaction_read_only`. | Transaction read-only plus the client-side read check. |

The UI uses the same words on both engines: database, table, view, column. It says "schema" only in the PostgreSQL tree.

## Safety

- Drop database, drop table, drop view, and drop column require typing the object name.
- In the editor, a statement whose first keyword is `DROP`, `TRUNCATE`, or `ALTER` (after optional leading comments) asks for a yes/no confirmation naming the verb. Read-only connections never reach this step; they are rejected earlier.
- Passwords are not written to the connection file, logs, history, or error dialogs.
- Query text and result rows are not written to disk, except the history text described above.
- The app does not phone home. No account, no telemetry.

## Non-functional

- PostgreSQL 14, 15, 16, 17. MySQL 8.0 and 8.4.
- The tree stays clickable while an editor query runs.
- Connection test and connect surface a timeout at 10 seconds.
- Result grids hold at most 5,000 rows in memory.
- The connection file is plain local data with no password field.

## v1 is done when

1. A PostgreSQL connection and a MySQL connection can be saved, tested, reopened, and deleted. The connection file contains no password.
2. The tree shows databases, tables, views, and columns for both engines, and hides system schemas until asked.
3. The user can create a database and a three-column table with a primary key from forms, see the SQL, run it, and find the table in the tree.
4. The user can drop that table only after typing its name.
5. Opening the table, applying one filter, sorting a column, hiding a column, and paging to the next window all change the visible SQL and the rows.
6. The editor runs a `SELECT`, shows rows, runs an invalid statement, shows the server error, and cancels a statement that hits the timeout.
7. A read-only connection can browse and `SELECT`, and refuses a `DROP` or `INSERT` before it is sent.
8. The user can create and drop an index, and create and drop a foreign key, from forms that show the SQL first.
9. The user can export the filtered data grid, and the rows already shown for a query, as CSV.
10. The editor suggests tables, views, and columns for the current database.

## Later, not v1

In rough order, only after the done-when list is true:

1. SSH tunnel on a connection.
2. Edit, insert, and delete rows from the grid, each change confirmed.
3. Windows and Linux builds.

## Open questions

Only these still change the spec:

1. **Distribution.** Personal tool on this Mac, or an app other people install? v1 assumes personal. Packaging, signing, and auto-update wait on the answer.
2. **SSH on day one.** v1 assumes the database port is reachable directly. If the only real database is behind a bastion, SSH moves into v1 and something else slips.
3. **Row editing.** v1 assumes the grid is read-only. If editing rows is required for the first usable version, it needs its own confirmation rules before building.
