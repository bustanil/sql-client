import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { api, type ClientConfig } from "./api";
import { OverflowTip } from "./overflow";
import type { RowScope } from "./grid";
import type { LiveSession } from "./workspace";

type Column = { name: string; type: string; nullable: boolean; default?: string; primaryKey: boolean };
type Kind = "connection" | "database" | "schema" | "folder" | "table" | "view" | "column";
type IconName = "connection" | "database" | "table" | "pk" | "fk" | "index";

type Row = {
  id: string;
  label: string;
  kind: Kind;
  depth: number;
  database?: string;
  schema?: string;
  table?: string;
  meta?: string;
  expandable: boolean;
  icon?: IconName;
};

export function Explorer({
  config,
  session,
  toolbarRoot,
  rowScope,
  onPick,
  onSession,
  onOpen,
  onCreate,
}: {
  config: ClientConfig;
  session: LiveSession;
  toolbarRoot: HTMLElement | null;
  rowScope: RowScope | null;
  onPick: () => void;
  onSession: (next: LiveSession) => void;
  onOpen: (target: { database?: string; schema?: string; relation: string }) => void;
  onCreate: (kind: "database" | "table", schema?: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["conn"]));
  const [cache, setCache] = useState<Record<string, Row[]>>({});
  const [filter, setFilter] = useState("");
  const [system, setSystem] = useState(false);
  const [selected, setSelected] = useState("conn");
  const [menu, setMenu] = useState<{ x: number; y: number; item: Row } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<Row | null>(null);
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState("");
  const [alter, setAlter] = useState<AlterDraft | null>(null);

  async function loadDatabases() {
    const names = await api<string[]>(config, `/sessions/${session.sessionId}/databases?system=${system ? "1" : "0"}`);
    return names.map((name) => row(`db:${name}`, name, "database", 1, { database: name, expandable: true, icon: "database" }));
  }

  useEffect(() => {
    loadDatabases()
      .then((items) => setCache((prev) => ({ ...prev, conn: items })))
      .catch((err: Error) => setError(err.message));
  }, [system, session.sessionId]);

  useEffect(() => {
    if (!menu) return;
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    const visible: Row[] = [row("conn", session.name, "connection", 0, { expandable: true, icon: "connection" })];
    function walk(id: string) {
      if (!expanded.has(id)) return;
      for (const child of cache[id] || []) {
        if (filter && !matches(child, cache, filter)) continue;
        visible.push(child);
        walk(child.id);
      }
    }
    walk("conn");
    setRows(visible);
  }, [cache, expanded, filter, session.name]);

  async function toggle(item: Row) {
    const next = new Set(expanded);
    if (next.has(item.id)) {
      next.delete(item.id);
      setExpanded(next);
      setSelected(item.id);
      return;
    }
    setError("");
    try {
      if (item.kind === "database" && item.database && item.database !== session.database) {
        const switched = await api<Omit<LiveSession, "name">>(config, `/sessions/${session.sessionId}/database`, {
          method: "POST",
          body: JSON.stringify({ database: item.database }),
        });
        onSession({ ...session, ...switched });
      }
      if (!cache[item.id]) {
        const children = await childrenOf(config, session, item, system);
        setCache((prev) => ({ ...prev, [item.id]: children }));
      }
      next.add(item.id);
      setExpanded(next);
      setSelected(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }

  async function refresh() {
    setCache({});
    setExpanded(new Set(["conn"]));
    const items = await loadDatabases();
    setCache({ conn: items });
  }

  function openAlter(kind: AlterDraft["kind"], table: Row) {
    setAlter({ kind, table, name: "", column: "", refTable: "", refColumn: "", sql: "", error: "" });
  }

  function editAlter(patch: Partial<Pick<AlterDraft, "name" | "column" | "refTable" | "refColumn">>) {
    setAlter((prev) => (prev ? { ...prev, ...patch, sql: "", error: "" } : prev));
  }

  async function submitAlter(event: FormEvent) {
    event.preventDefault();
    if (!alter) return;
    const draft = alter;
    const ready = draft.kind === "index" ? draft.name && draft.column : draft.name && draft.column && draft.refTable && draft.refColumn;
    if (!ready) {
      setAlter({ ...draft, error: "Fill in every field." });
      return;
    }
    try {
      if (!draft.sql) {
        const body =
          draft.kind === "index"
            ? { action: "createIndex", name: draft.name, table: draft.table.table || draft.table.label, schema: draft.table.schema, columns: [{ name: draft.column }] }
            : {
                action: "createForeignKey",
                name: draft.name,
                table: draft.table.table || draft.table.label,
                schema: draft.table.schema,
                refTable: draft.refTable,
                columns: [{ name: draft.column }],
                refColumns: [draft.refColumn],
                onDelete: "NO ACTION",
                onUpdate: "NO ACTION",
              };
        const preview = await api<{ sql: string }>(config, `/sessions/${session.sessionId}/ddl/preview`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        setAlter({ ...draft, sql: preview.sql, error: "" });
        return;
      }
      if (draft.table.database && draft.table.database !== session.database) {
        const switched = await api<Omit<LiveSession, "name">>(config, `/sessions/${session.sessionId}/database`, {
          method: "POST",
          body: JSON.stringify({ database: draft.table.database }),
        });
        onSession({ ...session, ...switched });
      }
      await api(config, `/sessions/${session.sessionId}/execute`, { method: "POST", body: JSON.stringify({ sql: draft.sql }) });
      setAlter(null);
      await refresh();
    } catch (err) {
      setAlter({ ...draft, error: err instanceof Error ? err.message : "Request failed" });
    }
  }

  async function drop() {
    if (!dropTarget || typedName !== dropTarget.label) return;
    const action =
      dropTarget.kind === "database" ? "dropDatabase" : dropTarget.kind === "view" ? "dropView" : dropTarget.kind === "column" ? "dropColumn" : "dropTable";
    const body = {
      action,
      name: dropTarget.label,
      schema: dropTarget.schema,
      table: dropTarget.table,
      columns: dropTarget.kind === "column" ? [{ name: dropTarget.label }] : undefined,
    };
    const preview = await api<{ sql: string }>(config, `/sessions/${session.sessionId}/ddl/preview`, { method: "POST", body: JSON.stringify(body) });
    await api(config, `/sessions/${session.sessionId}/execute`, { method: "POST", body: JSON.stringify({ sql: preview.sql }) });
    setDropTarget(null);
    setTypedName("");
    await refresh();
  }

  const selectedRow = rows.find((item) => item.id === selected);
  return (
    <>
      <div className="tree-tools">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter loaded names" aria-label="Filter loaded names" />
        <label className="check">
          <input type="checkbox" checked={system} onChange={(e) => setSystem(e.target.checked)} /> Show system schemas
        </label>
      </div>
      {error && <p className="empty">{error}</p>}
      <div className="tree">
        {rows.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tree-row"
            style={{ paddingLeft: 4 + item.depth * 14 }}
            aria-selected={item.id === selected}
            aria-current={item.kind === "database" && item.database === session.database ? true : undefined}
            onClick={(event) => {
              setSelected(item.id);
              onPick();
              const target = event.target as HTMLElement;
              if (item.expandable && target.closest(".chevron")) void toggle(item);
            }}
            onDoubleClick={() => {
              if (item.kind === "table" || item.kind === "view") {
                onOpen({ database: item.database, schema: item.schema, relation: item.label });
                return;
              }
              if (item.expandable) void toggle(item);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelected(item.id);
              onPick();
              setMenu({ x: event.clientX, y: event.clientY, item });
            }}
          >
            <span className={item.expandable ? "chevron has" + (expanded.has(item.id) ? " open" : "") : "chevron"} />
            {item.icon && <TreeIcon name={item.icon} />}
            <OverflowTip className="tree-label" text={item.label} />
            {item.meta && <span className="tree-meta">{item.meta}</span>}
            {item.kind === "database" && item.database === session.database && <span className="tree-meta">current</span>}
          </button>
        ))}
      </div>
      {toolbarRoot &&
        createPortal(
          <div className="obj-toolbar" aria-label={rowScope ? "Row operations" : "Object operations"}>
            {rowScope ? (
              <>
                <span className="obj-kicker">Rows</span>
                <span className="obj-target">{rowScope.count} selected</span>
                <button className="btn" type="button" onClick={rowScope.exportCSV}>
                  Export CSV
                </button>
              </>
            ) : (
              <>
            <span className="obj-kicker">{selectedRow?.kind || "connection"}</span>
            <OverflowTip className="obj-target" text={selectedRow?.label || session.name} />
            <button className="btn" type="button" onClick={() => void refresh()}>
              Refresh
            </button>
            {!session.readOnly && (
              <button className="btn" type="button" onClick={() => onCreate("database")}>
                Create database
              </button>
            )}
            {!session.readOnly && selectedRow?.kind === "table" && (
              <button className="btn" type="button" onClick={() => openAlter("index", selectedRow)}>
                Create index
              </button>
            )}
            {!session.readOnly && selectedRow?.kind === "table" && (
              <button className="btn" type="button" onClick={() => openAlter("foreignKey", selectedRow)}>
                Create foreign key
              </button>
            )}
            {!session.readOnly && selectedRow && ["table", "view", "database", "column"].includes(selectedRow.kind) && (
              <button
                className="btn danger-text"
                type="button"
                onClick={() => {
                  setDropTarget(selectedRow);
                  setTypedName("");
                }}
              >
                Drop
              </button>
            )}
            {!session.readOnly && (selectedRow?.kind === "schema" || selectedRow?.kind === "database") && (
              <button className="btn" type="button" onClick={() => onCreate("table", selectedRow.schema || "public")}>
                Create table
              </button>
            )}
            {(selectedRow?.kind === "table" || selectedRow?.kind === "view") && (
              <button
                className="btn"
                type="button"
                onClick={() => onOpen({ database: selectedRow.database, schema: selectedRow.schema, relation: selectedRow.label })}
              >
                Open data
              </button>
            )}
              </>
            )}
          </div>,
          toolbarRoot,
        )}
      {dropTarget && (
        <div className="scrim">
          <div className="sheet narrow">
            <h2>Drop {dropTarget.kind}</h2>
            <p>Type {dropTarget.label} to confirm.</p>
            <input value={typedName} onChange={(e) => setTypedName(e.target.value)} aria-label="Object name" />
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={() => setDropTarget(null)}>Cancel</button>
              <button className="btn btn-danger" type="button" disabled={typedName !== dropTarget.label} onClick={() => void drop()}>Drop</button>
            </div>
          </div>
        </div>
      )}
      {alter && (
        <div className="scrim">
          <form className="sheet narrow" onSubmit={(event) => void submitAlter(event)}>
            <h2>{alter.kind === "index" ? "Create index" : "Create foreign key"}</h2>
            <p className="help">
              On {alter.table.schema ? `${alter.table.schema}.${alter.table.label}` : alter.table.label}. The statement runs only after you confirm it.
            </p>
            <div className="fields">
              <label className="field">
                {alter.kind === "index" ? "Index name" : "Constraint name"}
                <input value={alter.name} onChange={(e) => editAlter({ name: e.target.value })} autoFocus />
              </label>
              <label className="field">
                {alter.kind === "index" ? "Column" : "Local column"}
                <input value={alter.column} onChange={(e) => editAlter({ column: e.target.value })} />
              </label>
              {alter.kind === "foreignKey" && (
                <>
                  <label className="field">
                    Referenced table
                    <input value={alter.refTable} onChange={(e) => editAlter({ refTable: e.target.value })} />
                  </label>
                  <label className="field">
                    Referenced column
                    <input value={alter.refColumn} onChange={(e) => editAlter({ refColumn: e.target.value })} />
                  </label>
                </>
              )}
            </div>
            {alter.kind === "foreignKey" && <p className="help">ON DELETE and ON UPDATE are NO ACTION.</p>}
            {alter.sql && <pre className="alter-sql">{alter.sql}</pre>}
            {alter.error && <p className="test-line bad">{alter.error}</p>}
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={() => setAlter(null)}>Cancel</button>
              <button className="btn btn-primary" type="submit">{alter.sql ? "Run" : "Show SQL"}</button>
            </div>
          </form>
        </div>
      )}
      {menu && (
        <div className="menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu">
          {(menu.item.kind === "table" || menu.item.kind === "view") && (
            <button type="button" onClick={() => { onOpen({ database: menu.item.database, schema: menu.item.schema, relation: menu.item.label }); setMenu(null); }}>
              Open data
            </button>
          )}
          <button type="button" onClick={() => { void refresh(); setMenu(null); }}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}

function TreeIcon({ name }: { name: IconName }) {
  return (
    <svg className={"tree-icon " + name} viewBox="0 0 16 16" aria-hidden="true">
      {name === "connection" && (
        <>
          <circle cx="4" cy="8" r="2" />
          <path d="M6 8h4" />
          <circle cx="12" cy="8" r="2" />
        </>
      )}
      {name === "database" && (
        <>
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
          <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </>
      )}
      {name === "table" && (
        <>
          <rect x="2.5" y="3" width="11" height="10" rx="1" />
          <path d="M2.5 7h11M7 7v6" />
        </>
      )}
      {name === "pk" && (
        <>
          <circle cx="5" cy="8" r="2.2" />
          <path d="M7.2 8H14M11.5 8v2.2M13.4 8v2.2" />
        </>
      )}
      {name === "fk" && (
        <>
          <circle cx="4.5" cy="8" r="2" />
          <path d="M6.5 8H10M10 8l2.5-2.2M10 8l2.5 2.2" />
        </>
      )}
      {name === "index" && (
        <>
          <path d="M3 4h10M3 8h10M3 12h6" />
          <path d="M11 11.2 13.2 13" />
        </>
      )}
    </svg>
  );
}

type AlterDraft = {
  kind: "index" | "foreignKey";
  table: Row;
  name: string;
  column: string;
  refTable: string;
  refColumn: string;
  sql: string;
  error: string;
};

function row(id: string, label: string, kind: Kind, depth: number, extra: Partial<Row>): Row {
  return { id, label, kind, depth, expandable: false, ...extra };
}

function matches(item: Row, cache: Record<string, Row[]>, filter: string): boolean {
  const q = filter.toLowerCase();
  if (item.label.toLowerCase().includes(q)) return true;
  return (cache[item.id] || []).some((child) => matches(child, cache, filter));
}

async function childrenOf(config: ClientConfig, session: LiveSession, item: Row, system: boolean): Promise<Row[]> {
  const base = `/sessions/${session.sessionId}`;
  if (item.kind === "database" && session.engine === "PostgreSQL") {
    const names = await api<string[]>(config, `${base}/schemas?system=${system ? "1" : "0"}`);
    return names.map((name) => row(`sc:${item.database}.${name}`, name, "schema", item.depth + 1, { database: item.database, schema: name, expandable: true }));
  }
  if (item.kind === "database" || item.kind === "schema") {
    const database = item.database || session.database;
    const schema = item.schema;
    return [
      row(`folder:${item.id}:tables`, "Tables", "folder", item.depth + 1, { database, schema, expandable: true }),
      row(`folder:${item.id}:views`, "Views", "folder", item.depth + 1, { database, schema, expandable: true }),
    ];
  }
  if (item.kind === "folder" && item.label === "Indexes") {
    const names = await api<string[]>(config, `${base}/indexes?${query(session, item)}&table=${encodeURIComponent(item.table || "")}`);
    return names.map((name) => row(`index:${item.table}.${name}`, name, "column", item.depth + 1, { table: item.table, schema: item.schema, database: item.database, icon: "index" }));
  }
  if (item.kind === "folder" && item.label === "Foreign keys") {
    const names = await api<string[]>(config, `${base}/foreign-keys?${query(session, item)}&table=${encodeURIComponent(item.table || "")}`);
    return names.map((name) => row(`fkey:${item.table}.${name}`, name, "column", item.depth + 1, { table: item.table, schema: item.schema, database: item.database, icon: "fk" }));
  }
  if (item.kind === "folder" && item.label === "Tables") {
    const q = query(session, item);
    const names = await api<string[]>(config, `${base}/tables?${q}`);
    return names.map((name) => row(`table:${item.database}.${item.schema || ""}.${name}`, name, "table", item.depth + 1, { database: item.database, schema: item.schema, table: name, expandable: true, icon: "table" }));
  }
  if (item.kind === "folder") {
    const q = query(session, item);
    const names = await api<string[]>(config, `${base}/views?${q}`);
    return names.map((name) => row(`view:${item.database}.${item.schema || ""}.${name}`, name, "view", item.depth + 1, { database: item.database, schema: item.schema }));
  }
  if (item.kind === "table") {
    const q = query(session, item) + `&table=${encodeURIComponent(item.table || "")}`;
    const cols = await api<Column[]>(config, `${base}/columns?${q}`);
    const columnRows = cols.map((col) => {
      const meta = [col.type, col.primaryKey ? "PK" : "", col.nullable ? "null" : ""].filter(Boolean).join(" · ");
      return row(`col:${item.id}.${col.name}`, col.name, "column", item.depth + 1, { meta, icon: col.primaryKey ? "pk" : undefined, table: item.table, schema: item.schema, database: item.database });
    });
    return [
      ...columnRows,
      row(`idx:${item.id}`, "Indexes", "folder", item.depth + 1, { database: item.database, schema: item.schema, table: item.table, expandable: true }),
      row(`fk:${item.id}`, "Foreign keys", "folder", item.depth + 1, { database: item.database, schema: item.schema, table: item.table, expandable: true }),
    ];
  }
  return [];
}

function query(session: LiveSession, item: Row) {
  const params = new URLSearchParams();
  if (item.database) params.set("database", item.database);
  if (session.engine === "PostgreSQL" && item.schema) params.set("schema", item.schema);
  return params.toString();
}
