import { useEffect, useState } from "react";
import { api, type ClientConfig } from "./api";

type Page = {
  sql: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  window: { start: number; end: number };
};

export type GridTarget = { database?: string; schema?: string; relation: string };

type Filter = { column: string; op: string; value: string };

export function DataGrid({ config, sessionId, target }: { config: ClientConfig; sessionId: string; target: GridTarget }) {
  const [pageSize, setPageSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [draft, setDraft] = useState<Filter>({ column: "", op: "contains", value: "" });
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setOffset(0);
    setVisible(null);
    setFilters([]);
    setSort(null);
    setCount(null);
  }, [target.relation, target.schema, target.database]);

  useEffect(() => {
    const body: Record<string, unknown> = {
      database: target.database,
      schema: target.schema,
      relation: target.relation,
      limit: pageSize,
      offset,
      filters,
    };
    if (visible) body.columns = visible;
    if (sort) body.sort = sort;
    api<Page>(config, `/sessions/${sessionId}/browse`, { method: "POST", body: JSON.stringify(body) })
      .then((next) => {
        setPage(next);
        setVisible((current) => current ?? next.columns);
        setDraft((current) => ({ ...current, column: current.column || next.columns[0] || "" }));
        setError("");
      })
      .catch((err: Error) => setError(err.message));
  }, [config, sessionId, target.database, target.schema, target.relation, pageSize, offset, filters, sort, visible]);

  const start = page?.window.start || 0;
  const end = page?.window.end || 0;
  return (
    <div className="grid-pane">
      <div className="toolbar">
        <span className="obj-target">{target.relation}</span>
        {visible?.map((name) => (
          <label key={name} className="check">
            <input
              type="checkbox"
              checked
              disabled={visible.length === 1}
              onChange={() => {
                setVisible(visible.filter((item) => item !== name));
                setFilters(filters.filter((filter) => filter.column !== name));
                if (sort?.column === name) setSort(null);
                setCount(null);
              }}
            />
            {name}
          </label>
        ))}
        <select aria-label="Filter column" value={draft.column} onChange={(e) => setDraft({ ...draft, column: e.target.value })}>
          {(visible || []).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Filter operator" value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value })}>
          <option value="eq">equals</option>
          <option value="neq">not equals</option>
          <option value="contains">contains</option>
          <option value="gt">greater than</option>
          <option value="lt">less than</option>
          <option value="empty">is empty</option>
          <option value="notempty">is not empty</option>
        </select>
        <input
          aria-label="Filter value"
          value={draft.value}
          disabled={draft.op === "empty" || draft.op === "notempty"}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!draft.column) return;
            if (draft.op !== "empty" && draft.op !== "notempty" && draft.value === "") return;
            setFilters([...filters, draft]);
            setOffset(0);
            setCount(null);
          }}
        >
          Apply
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => { setFilters([]); setOffset(0); setCount(null); }}>
          Clear
        </button>
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
        <button className="btn" type="button" onClick={() => {
          api<{ count: number }>(config, `/sessions/${sessionId}/browse/count`, {
            method: "POST",
            body: JSON.stringify({ database: target.database, schema: target.schema, relation: target.relation, columns: visible, filters }),
          }).then((result) => setCount(result.count)).catch((err: Error) => setError(err.message));
        }}>
          Count
        </button>
        {count !== null && <span className="meta">Count: {count}</span>}
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
                  <th
                    key={name}
                    onClick={() => {
                      setSort((current) => {
                        if (!current || current.column !== name) return { column: name, dir: "asc" };
                        if (current.dir === "asc") return { column: name, dir: "desc" };
                        return null;
                      });
                    }}
                  >
                    {name}
                    {sort?.column === name ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
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
