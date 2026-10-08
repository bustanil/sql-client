import { useEffect, useState } from "react";
import { api, type ClientConfig } from "./api";
import type { LiveSession } from "./workspace";

type Column = { name: string; type: string; nullable: boolean; default?: string; primaryKey: boolean };
type Kind = "connection" | "database" | "schema" | "folder" | "table" | "view" | "column";

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
};

export function Explorer({
  config,
  session,
  onSession,
}: {
  config: ClientConfig;
  session: LiveSession;
  onSession: (next: LiveSession) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["conn"]));
  const [cache, setCache] = useState<Record<string, Row[]>>({});
  const [filter, setFilter] = useState("");
  const [system, setSystem] = useState(false);
  const [selected, setSelected] = useState("conn");
  const [error, setError] = useState("");

  async function loadDatabases() {
    const names = await api<string[]>(config, `/sessions/${session.sessionId}/databases?system=${system ? "1" : "0"}`);
    return names.map((name) => row(`db:${name}`, name, "database", 1, { database: name, expandable: true }));
  }

  useEffect(() => {
    loadDatabases()
      .then((items) => setCache((prev) => ({ ...prev, conn: items })))
      .catch((err: Error) => setError(err.message));
  }, [system, session.sessionId]);

  useEffect(() => {
    const visible: Row[] = [row("conn", session.name, "connection", 0, { expandable: true })];
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
        onSession({ ...switched, name: session.name });
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
            onClick={() => void toggle(item)}
          >
            <span className={item.expandable ? "chevron has" + (expanded.has(item.id) ? " open" : "") : "chevron"} />
            <span className="tree-label">{item.label}</span>
            {item.meta && <span className="tree-meta">{item.meta}</span>}
            {item.kind === "database" && item.database === session.database && <span className="tree-meta">current</span>}
          </button>
        ))}
      </div>
      <div className="obj-toolbar">
        <span className="obj-kicker">{selectedRow?.kind || "connection"}</span>
        <span className="obj-target">{selectedRow?.label || session.name}</span>
        <button className="btn" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
    </>
  );
}

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
  if (item.kind === "folder" && item.label === "Tables") {
    const q = query(session, item);
    const names = await api<string[]>(config, `${base}/tables?${q}`);
    return names.map((name) => row(`table:${item.database}.${item.schema || ""}.${name}`, name, "table", item.depth + 1, { database: item.database, schema: item.schema, table: name, expandable: true }));
  }
  if (item.kind === "folder") {
    const q = query(session, item);
    const names = await api<string[]>(config, `${base}/views?${q}`);
    return names.map((name) => row(`view:${item.database}.${item.schema || ""}.${name}`, name, "view", item.depth + 1, { database: item.database, schema: item.schema }));
  }
  if (item.kind === "table") {
    const q = query(session, item) + `&table=${encodeURIComponent(item.table || "")}`;
    const cols = await api<Column[]>(config, `${base}/columns?${q}`);
    return cols.map((col) => {
      const meta = [col.type, col.primaryKey ? "PK" : "", col.nullable ? "null" : ""].filter(Boolean).join(" · ");
      return row(`col:${item.id}.${col.name}`, col.name, "column", item.depth + 1, { meta });
    });
  }
  return [];
}

function query(session: LiveSession, item: Row) {
  const params = new URLSearchParams();
  if (item.database) params.set("database", item.database);
  if (session.engine === "PostgreSQL" && item.schema) params.set("schema", item.schema);
  return params.toString();
}
