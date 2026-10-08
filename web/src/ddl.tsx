import { useEffect, useState } from "react";
import { api, type ClientConfig } from "./api";

type Column = { name: string; type: string; nullable: boolean; primaryKey: boolean; default: string };

export function DDLForm({
  config,
  sessionId,
  engine,
  schema,
  mode,
  onDone,
  onCancel,
}: {
  config: ClientConfig;
  sessionId: string;
  engine: string;
  schema?: string;
  mode: "database" | "table";
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(mode === "database" ? "billing" : "invoices");
  const [columns, setColumns] = useState<Column[]>([
    { name: "id", type: engine === "MySQL" ? "bigint" : "bigint generated always as identity", nullable: false, primaryKey: true, default: "" },
    { name: "total", type: engine === "MySQL" ? "decimal(12, 2)" : "numeric(12, 2)", nullable: false, primaryKey: false, default: "" },
  ]);
  const [sql, setSQL] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const body =
      mode === "database"
        ? { action: "createDatabase", name }
        : { action: "createTable", name, schema, columns };
    api<{ sql: string }>(config, `/sessions/${sessionId}/ddl/preview`, { method: "POST", body: JSON.stringify(body) })
      .then((result) => {
        setSQL(result.sql);
        setError("");
      })
      .catch((err: Error) => setError(err.message));
  }, [config, sessionId, mode, name, schema, columns, engine]);

  async function run() {
    try {
      await api(config, `/sessions/${sessionId}/execute`, { method: "POST", body: JSON.stringify({ sql }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    }
  }

  return (
    <div className="ddl">
      <h2>{mode === "database" ? "Create database" : "Create table"}</h2>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {mode === "table" &&
        columns.map((column, index) => (
          <div className="fields" key={index}>
            <input
              aria-label="Column name"
              value={column.name}
              onChange={(e) => setColumns(columns.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
            />
            <input
              aria-label="Column type"
              value={column.type}
              onChange={(e) => setColumns(columns.map((item, i) => (i === index ? { ...item, type: e.target.value } : item)))}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={column.primaryKey}
                onChange={(e) => setColumns(columns.map((item, i) => (i === index ? { ...item, primaryKey: e.target.checked, nullable: e.target.checked ? false : item.nullable } : item)))}
              />
              PK
            </label>
          </div>
        ))}
      {mode === "table" && (
        <button className="btn" type="button" onClick={() => setColumns([...columns, { name: "", type: "text", nullable: true, primaryKey: false, default: "" }])}>
          Add column
        </button>
      )}
      <label className="field">
        Statement
        <textarea className="sql-box" value={sql} onChange={(e) => setSQL(e.target.value)} />
      </label>
      {error && <p className="test-line bad">{error}</p>}
      <div className="sheet-actions">
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" onClick={() => void run()}>
          Run
        </button>
      </div>
    </div>
  );
}
