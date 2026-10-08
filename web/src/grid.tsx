import { useEffect, useState } from "react";
import { api, type ClientConfig } from "./api";

type Page = {
  sql: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  window: { start: number; end: number };
};

export type GridTarget = { database?: string; schema?: string; relation: string };

export function DataGrid({ config, sessionId, target }: { config: ClientConfig; sessionId: string; target: GridTarget }) {
  const [pageSize, setPageSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOffset(0);
  }, [target.relation, target.schema, target.database]);

  useEffect(() => {
    api<Page>(config, `/sessions/${sessionId}/browse`, {
      method: "POST",
      body: JSON.stringify({
        database: target.database,
        schema: target.schema,
        relation: target.relation,
        limit: pageSize,
        offset,
      }),
    })
      .then((next) => {
        setPage(next);
        setError("");
      })
      .catch((err: Error) => setError(err.message));
  }, [config, sessionId, target.database, target.schema, target.relation, pageSize, offset]);

  const start = page?.window.start || 0;
  const end = page?.window.end || 0;
  return (
    <div className="grid-pane">
      <div className="toolbar">
        <span className="obj-target">{target.relation}</span>
        <span className="spacer" />
        <label className="meta">
          Rows
          <select
            aria-label="Page size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setOffset(0);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </label>
        <span className="meta">{start && end ? `${start}–${end}` : "0 rows"}</span>
        <button className="btn" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
          Previous
        </button>
        <button className="btn" type="button" disabled={!page || page.rows.length < pageSize} onClick={() => setOffset(offset + pageSize)}>
          Next
        </button>
      </div>
      {error && <p className="empty">{error}</p>}
      {page && (
        <div className="grid-scroll">
          <table className="grid">
            <thead>
              <tr>
                {page.columns.map((name) => (
                  <th key={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={cell === null ? "nil" : ""}>
                      {cell === null ? "NULL" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="statement" open>
        <summary>Statement</summary>
        <pre>{page?.sql}</pre>
        <div className="hint">Filter values are parameters. This statement is read-only.</div>
      </details>
    </div>
  );
}
