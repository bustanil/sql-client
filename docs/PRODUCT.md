# SQL Client — Product Spec

Status: current  
Version: 0.1  
Engines: PostgreSQL 14–17, MySQL 8.0 and 8.4

A local Mac app for one person to connect to PostgreSQL and MySQL, browse schema, change structure, inspect rows, and run SQL.

The window is an Electron shell written in TypeScript. The screen is React. A Go process, started by Electron, is the only process that opens a database connection. Passwords stay in the macOS keychain. The connection file has no password.

The process split and HTTP API are in [ARCHITECTURE.md](ARCHITECTURE.md). The original build order is in [TASKS.md](TASKS.md).

## Decisions

| Decision | Choice |
| --- | --- |
| Where it runs | On this Mac. Not a hosted service. |
| Who it's for | One person. No accounts, no sync. |
| Data grid | Read-only. No cell editing. |
| DDL for database and table | A form builds SQL. The user can edit the statement, then run it. |
| Indexes and foreign keys | Prompts collect the names, then the app shows the SQL and asks for confirmation. |
| Reachability | Direct TCP, with TLS options. No SSH tunnel. |
| Engines | PostgreSQL and MySQL. MariaDB is not a target. |
| Packaging | `npm run pack` builds a Mac app. GitHub Actions builds an ad-hoc signed Apple Silicon disk image. |

## Who it's for

A developer working against a local or remote PostgreSQL or MySQL database. They already know SQL. They want one window for connections, schema, structure changes, row inspection, and ad hoc queries.

## What the app does

1. Save a connection once and reopen it without retyping the password.
2. See databases, schemas, tables, views, columns, indexes, and foreign keys.
3. Create and drop databases and tables from a form that shows the SQL.
4. Create and drop indexes and foreign keys by confirming generated SQL.
5. Open a table and narrow the page: filter, sort, hide columns, page through rows.
6. Select rows and cells, copy a highlighted cell, and export selected rows.
7. Run SQL in its own session and see rows or the server error.
8. Export the filtered grid, or the rows already returned by a query, as CSV.
9. Complete table and column names in the editor.

## Not in this version

- Other databases, SSH tunnels, proxies, and cloud identity.
- Editing, inserting, or deleting rows. Importing CSV.
- A separate add-column or show-definition screen. `CREATE VIEW` and `TRUNCATE` as forms.
- Refusing to drop the last column of a table.
- Several query tabs, tab rename, or running only the selection.
- Moving the editor cursor to a server error position.
- Truncating long cell text, or rendering binary values as a byte length.
- A custom app icon, Developer ID signing, notarization, and auto-update.
- Windows and Linux builds.

## Window

After a connection opens:

1. **Operation toolbar** across the top, above both the sidebar and the main pane. It acts on the selected object. When rows are selected in the grid or in a query result, it switches to row actions.
2. **Object explorer** on the left. Width is dragged from the right edge, between 240px and the window width minus 320px, and the width is remembered. A truncated name shows in full when the pointer is over it.
3. **Main pane** on the right. One surface at a time: a data grid, a DDL form, or a SQL editor.
4. **Status line** under the main pane. Connection name, engine, current database, and idle.

The object tree uses its own database session. A query tab has another session, so a running query does not freeze the tree. The open query follows the database selected in the explorer. PostgreSQL connections use `public` on the search path, so an unqualified table name in `public` resolves.

Disconnect closes the explorer session and the open query or grid. There is no extra confirm.

The explorer context menu closes when the pointer goes down outside it, and when Escape is pressed.

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
| Database | No | Database selected on connect. If empty, PostgreSQL connects to `postgres`, or to the username if that database does not exist. MySQL connects with no default database. |
| TLS | Yes | `Off`, `Require` (encrypt, do not verify the certificate), or `Verify` (encrypt and verify). |
| Read-only | Yes | Default off. |

### Behavior

- **Test** opens a session, runs `SELECT 1`, and shows success or the server's error text. It does not save.
- Test and connect fail visibly within 10 seconds if the host does not answer.
- The saved record on disk contains everything except the password. A keychain lookup failure on connect asks for the password again and offers to store it.
- Delete asks for confirmation. It removes the record and the keychain item. It does not drop anything on the server.
- Duplicate copies the record, appends " copy" to the name, and shares no password until the user saves one.
- A wrong password shows the server's authentication error.

### Read-only

When the flag is on:

- Create and drop actions in the explorer are hidden.
- Before sending editor SQL, the app rejects the statement if it does not look like a read (`SELECT`, `WITH` that is not a write, `SHOW`, `EXPLAIN`, or `VALUES`).
- The session is also set read-only on the server (PostgreSQL `default_transaction_read_only`; MySQL `SET SESSION TRANSACTION READ ONLY`).

## 2. Object browser

### Tree

PostgreSQL:

```
connection
  database
    schema
      Tables
        table
          column  type  nullability  key
          Indexes
            index
          Foreign keys
            foreign key
      Views
        view
```

MySQL has no schema level. A database contains `Tables` and `Views` directly.

Icons sit to the left of the name for the connection, a database, a table, a primary-key column, a foreign key, and an index.

- Children load when the node expands, not at connect time.
- The tree lists objects the connected user can see.
- PostgreSQL hides `pg_catalog` and `information_schema` until **Show system schemas** is on.
- MySQL hides `mysql`, `information_schema`, `performance_schema`, and `sys` until that toggle is on.
- A box filters names already loaded. It does not search the server.
- Clicking or right-clicking a tree object clears any selected grid rows.

### Actions

The operation toolbar follows the sidebar selection. Read-only connections omit every action that changes structure. The context menu offers Refresh, and Open data on a table or view.

| Action | Where | Result |
| --- | --- | --- |
| Refresh | Toolbar | Reloads the tree from the connection. |
| Open data | Table or view. Also double-click. | Opens the data grid for that relation. |
| Create database | Toolbar | Opens the create-database form. |
| Create table | Schema or database | Opens the create-table form. |
| Drop | Database, table, view, or column | The user types the name, then the drop runs. |
| Create index | Table | Prompts for the index name and one column, then confirms the SQL. |
| Create foreign key | Table | Prompts for the constraint name, local column, referenced table, and referenced column, then confirms the SQL. `ON DELETE` and `ON UPDATE` are `NO ACTION`. |
| Set current database | Expand a database | Later queries use it. PostgreSQL closes and reopens the same session id. MySQL runs `USE`. |

Column rows show name, data type, and whether the column is in the primary key. A nullable column is marked in the type line when the catalog says so.

## 3. DDL

Create database and create table follow one path: form, editable SQL, run, close.

1. The form collects the fields below.
2. The app generates one statement and shows it in an editable box.
3. **Run** executes that text, including edits. **Cancel** closes the form.
4. On failure, the error stays on the form.

The app quotes identifiers (PostgreSQL double quotes, MySQL backticks).

### Create database

| Field | PostgreSQL | MySQL |
| --- | --- | --- |
| Name | Required. | Required. |
| Defaults applied, not shown | Encoding `UTF8`. | Character set `utf8mb4`, collation `utf8mb4_0900_ai_ci`. |

### Drop database, table, view, or column

- The user must type the object name to enable **Drop**.
- Database: `DROP DATABASE`. Table: `DROP TABLE`. View: `DROP VIEW`. Column: `ALTER TABLE … DROP COLUMN`.
- PostgreSQL names are schema-qualified when a schema is known.
- The app does not refuse to drop the last column.

### Create table

| Field | Rule |
| --- | --- |
| Schema | PostgreSQL: the schema the user started from, default `public`. MySQL: the current database. |
| Table name | Required. |
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

- Checked primary-key columns become one `PRIMARY KEY (…)` in list order.
- Default is optional free text inserted verbatim. Empty means no `DEFAULT` clause.
- Nullable is on by default, off when the column is a primary key.

### Create index and foreign key

These are not full forms. The app asks for the names, builds the statement, and runs it only after the user confirms that SQL.

- Index: `CREATE INDEX` on one column. Not unique, not partial, not an expression.
- Foreign key: `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES …` for one column, `ON DELETE NO ACTION`, `ON UPDATE NO ACTION`, same database.

### Not in this version

Rename, change type, add column from its own form, `CREATE VIEW`, and `TRUNCATE` from a form. `TRUNCATE` typed into the editor still runs, with the confirmation in [Safety](#safety).

## 4. Data browser

Opening a table or view shows a read-only grid. The grid toolbar has the relation name, **Columns**, **Filters**, and **Export all**. Page size, **Count**, the window label, **Previous**, and **Next** sit in the grid footer. The statement that produced the page is in a **Statement** disclosure.

### Columns

- All columns start visible, in catalog order.
- **Columns** opens a dialog. **Select all** and **Select none** change the checks. **Apply** is disabled until at least one column is checked. **Cancel** and Escape discard the draft.
- When fewer columns are shown than the table has, the button carries a count of how many remain selected.
- Hiding a column removes it from the `SELECT` list.
- A hidden column can still be filtered. Hiding a column does not remove a filter on it.

### Sort

- One sort column.
- Clicking a header cycles: unsorted → ascending → descending → unsorted.
- Sorting replaces the previous sort.

### Filter

- **Filters** opens a dialog. The user can add several conditions.
- Each condition is a column, an operator, and a value when the operator needs one.
- Operators: equals, not equals, greater than, greater than or equal, less than, less than or equal, like (case-sensitive), like (case-insensitive), is empty, is not empty.
- **Is empty** and **is not empty** take no value (`IS NULL`, `IS NOT NULL`).
- Like uses the text the user typed, including `%` as a wildcard. Case-sensitive like is `LIKE` on PostgreSQL and `BINARY … LIKE` on MySQL. Case-insensitive like is `ILIKE` on PostgreSQL and `LOWER(column) LIKE LOWER(?)` on MySQL.
- Every condition is combined with `AND`.
- **Apply** runs the query. Typing does not. **Clear** removes every filter. **Cancel** discards the draft.
- Applied conditions stay visible above the grid as SQL text, for example `email ILIKE '%ada%'`. Each chip can be removed on its own.
- Values are bound as parameters. The **Statement** panel shows the full query with those placeholders, not with the values pasted in.

### Pages

- Page size defaults to 100. Choices: 50, 100, 500.
- **Previous** and **Next**. The label is the window, for example `101–200`, not a total.
- **Count** runs `COUNT(*)` with the same filters and no sort. It does not run automatically.
- There is no page-number jump.

### Rows and cells

- A click selects that row and highlights the clicked cell in blue. The rest of the row stays beige.
- Clicking another cell in a selected row moves the blue highlight and does not clear the row.
- Clicking the highlighted cell when it is the only selected row clears the selection.
- Shift extends the selection from the anchor row through the clicked row. Command toggles a row. Command-Shift adds that range.
- Clicking an object in the sidebar clears the row selection.
- Double-click copies a cell only when that cell is already the blue one. A double-click on another cell in the selected row moves the highlight and does not copy. `NULL` copies as an empty value. A toast says "Copied to clipboard" for 2 seconds.
- `NULL` renders as the label `NULL`, distinct from an empty string.
- The grid does not edit cells, delete rows, or insert rows.

### Export

- **Export all** on the grid toolbar writes every row that matches the current filters, sort, and visible columns, up to 100,000 rows. The grid says when the file stops at that cap.
- When one or more rows are selected, the operation toolbar switches to row actions: the selection count and **Export CSV**. That file is only the selected rows, in table order, with the column names on the first line. It does not run the query again.
- SQL `NULL` is an empty field. A value that contains a comma, a quote, or a newline is quoted, and quotes inside it are doubled. Electron asks where to save the file.

## 5. SQL editor

**New query** opens one editor for the current connection and the explorer's current database. Opening another query replaces it. There is no tab strip and no rename.

The query toolbar has **Run**, **Format**, **Cancel**, **History**, and **Export CSV**. **Timeout** and **Rows** sit in the footer of the query panel.

### Run

- The editor colors keywords, strings, numbers, comments, and operators.
- **Format** rewrites the editor text: clause keywords on their own lines, uppercase keywords, select lists broken on commas.
- **Run** sends the whole editor text. It does not limit itself to the selection or to the statement around the cursor.
- Several statements separated by semicolons run in order on that tab's session. The app stops at the first error. If a statement returns rows, that grid stays on screen.
- A statement still running disables **Run** and enables **Cancel**.
- A statement whose first keyword is `DROP`, `TRUNCATE`, or `ALTER` asks for confirmation. Read-only connections are rejected before that.

### Results

- A row-returning statement shows up to the footer **Rows** cap (1,000 or 5,000) and the elapsed time. The grid says when the result was truncated.
- Any other successful statement shows `N rows affected` when the server reports a count, otherwise `Done`, plus elapsed time.
- A failure shows the server message. The editor does not move the cursor to a server position.
- The result grid uses the same row and cell behavior as the data grid: selection, cell highlight, copy of the highlighted cell, and **Export CSV** of the selected rows from the operation toolbar. The query toolbar **Export CSV** writes every row already in the result. The result grid has no filter builder and no column picker. Sort and filter happen in SQL.

### Timeout

Default 30 seconds. Choices: 15 seconds, 30 seconds, 60 seconds, 5 minutes, no timeout. Go cancels the query context when the time is up. **Cancel** does the same on demand.

### History

- Each execution appends the statement text, timestamp, database, duration, and success or the error message.
- History keeps the last 100 entries per connection, newest first.
- Opening an entry replaces the text in the current editor. History does not store result rows.

Completion uses the query's database. It suggests tables and their columns, and it leaves out system schemas. Names are loaded when the editor opens.

## Engine differences

| Topic | PostgreSQL | MySQL |
| --- | --- | --- |
| Namespace | Database → schema → table. Default schema `public`. | Database → table. |
| Switching database | New session, same session id. | `USE`. |
| Search path | `public`, so unqualified names in `public` resolve. | The current database. |
| Identifier quotes | Double quotes. | Backticks. |
| Identity | `GENERATED ALWAYS AS IDENTITY`. | `AUTO_INCREMENT`. |
| Case-sensitive like | `LIKE`. | `BINARY column LIKE`. |
| Case-insensitive like | `ILIKE`. | `LOWER(column) LIKE LOWER(?)`. |

The UI uses the same words on both engines: database, table, view, column. It says "schema" only in the PostgreSQL tree.

## Safety

- Drop database, drop table, drop view, and drop column require typing the object name.
- In the editor, `DROP`, `TRUNCATE`, and `ALTER` ask for a yes/no confirmation. Read-only connections are rejected earlier.
- Passwords are not written to the connection file, logs, history, or error text.
- Query text in history is the only query text stored. Result rows are not written to disk except when the user exports CSV.
- Go listens on `127.0.0.1` only and requires the per-launch bearer secret.
- The app does not phone home.

## Non-functional

- PostgreSQL 14–17. MySQL 8.0 and 8.4.
- The tree stays usable while an editor query runs, because it has its own session.
- Connection test and connect surface a timeout at 10 seconds.
- A query result holds at most 5,000 rows. A grid export holds at most 100,000.
- The connection file is plain local data with no password field.

## Shipped when

1. A PostgreSQL connection and a MySQL connection can be saved, tested, reopened, and deleted. The connection file contains no password.
2. The tree shows databases, tables, views, columns, indexes, and foreign keys, and hides system schemas until asked.
3. The user can create a database and a table from forms, see the SQL, and run it.
4. The user can drop a table only after typing its name.
5. Opening a table, applying a filter, sorting a column, hiding a column, and paging change the visible SQL and the rows.
6. The editor runs a `SELECT`, shows rows, shows a server error, and cancels a statement.
7. A read-only connection can browse and `SELECT`, and refuses a write before it is sent.
8. The user can create an index and a foreign key by confirming the SQL.
9. The user can export the filtered grid, selected rows, and query results as CSV.
10. The editor suggests tables and columns and colors SQL.

## Later

1. SSH tunnel on a connection.
2. Edit, insert, and delete rows from the grid.
3. Developer ID signing, notarization, and a real app icon.
4. Windows and Linux builds.
