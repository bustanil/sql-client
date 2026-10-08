import { useEffect, useState } from "react";
import { api, type ClientConfig } from "./api";
import { saveCSV } from "./csv";
import { SelectableTable, type RowScope } from "./selectable";

export type { RowScope };

type Page = {
  sql: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  window: { start: number; end: number };
};

export type GridTarget = { database?: string; schema?: string; relation: string };

type Filter = { column: string; op: string; value: string };

const filterOps = [
  { op: "eq", label: "equals", needsValue: true },
  { op: "neq", label: "not equals", needsValue: true },
  { op: "gt", label: "greater than", needsValue: true },
  { op: "gte", label: "greater than or equal", needsValue: true },
  { op: "lt", label: "less than", needsValue: true },
  { op: "lte", label: "less than or equal", needsValue: true },
  { op: "like", label: "like, case-sensitive", needsValue: true },
  { op: "ilike", label: "like, case-insensitive", needsValue: true },
  { op: "empty", label: "is empty", needsValue: false },
  { op: "notempty", label: "is not empty", needsValue: false },
];

function needsFilterValue(op: string) {
  return op !== "empty" && op !== "notempty";
}

function filtersReady(rows: Filter[]) {
  return rows.every((row) => row.column !== "" && (!needsFilterValue(row.op) || row.value !== ""));
}

function filterSQL(filter: Filter) {
  if (filter.op === "empty") return `${filter.column} IS NULL`;
  if (filter.op === "notempty") return `${filter.column} IS NOT NULL`;
  const quoted = `'${filter.value.replaceAll("'", "''")}'`;
  if (filter.op === "like") return `${filter.column} LIKE ${quoted}`;
  if (filter.op === "ilike") return `${filter.column} ILIKE ${quoted}`;
  const symbol: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  return `${filter.column} ${symbol[filter.op] || "="} ${quoted}`;
}

export function DataGrid({
  config,
  sessionId,
  target,
  clearRows,
  onRowScope,
}: {
  config: ClientConfig;
  sessionId: string;
  target: GridTarget;
  clearRows: number;
  onRowScope?: (scope: RowScope | null) => void;
}) {
  const [pageSize, setPageSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [allColumns, setAllColumns] = useState<string[] | null>(null);
  const [visible, setVisible] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    setOffset(0);
    setAllColumns(null);
    setVisible(null);
    setFilters([]);
    setSort(null);
    setCount(null);
    setColumnsOpen(false);
  }, [target.relation, target.schema, target.database]);

  useEffect(() => {
    if (visible && visible.length === 0) {
      setPage({ sql: "", columns: [], rows: [], window: { start: 0, end: 0 } });
      setError("");
      return;
    }
    let cancelled = false;
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
        if (cancelled) return;
        setPage(next);
        setAllColumns((current) => current ?? next.columns);
        setVisible((current) => current ?? next.columns);
        setError("");
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [config, sessionId, target.database, target.schema, target.relation, pageSize, offset, filters, sort, visible]);

  useEffect(() => {
    if (!columnsOpen && !filtersOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setColumnsOpen(false);
        setFiltersOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [columnsOpen, filtersOpen]);

  function openFilters() {
    const column = (allColumns ?? [])[0] || "";
    setFilterDraft(filters.length > 0 ? filters.map((item) => ({ ...item })) : [{ column, op: "eq", value: "" }]);
    setFiltersOpen(true);
  }

  function updateFilter(index: number, next: Filter) {
    setFilterDraft(filterDraft.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }

  function applyFilters() {
    if (!filtersReady(filterDraft)) return;
    setFilters(filterDraft);
    setOffset(0);
    setCount(null);
    setFiltersOpen(false);
  }

  function openColumns() {
    setPicked([...(visible ?? allColumns ?? [])]);
    setColumnsOpen(true);
  }

  function toggleColumn(name: string) {
    setPicked((current) => {
      if (current.includes(name)) return current.filter((item) => item !== name);
      const chosen = new Set(current);
      chosen.add(name);
      return (allColumns ?? []).filter((item) => chosen.has(item));
    });
  }

  function applyColumns() {
    if (picked.length === 0) return;
    const next = picked;
    const kept = new Set(next);
    setVisible(next);
    if (sort && !kept.has(sort.column)) setSort(null);
    setCount(null);
    setColumnsOpen(false);
  }

  async function exportGrid() {
    const res = await fetch(`${config.origin}/sessions/${sessionId}/export`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ database: target.database, schema: target.schema, relation: target.relation, columns: visible, filters, sort }),
    });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    if (res.headers.get("X-Truncated") === "1") setError("Export stopped at 100,000 rows.");
    await saveCSV(`${target.relation}.csv`, await res.text());
  }

  const start = page?.window.start || 0;
  const end = page?.window.end || 0;
  return (
    <div className="grid-pane">
      <div className="toolbar">
        <span className="obj-target">{target.relation}</span>
        <button
          className="btn"
          type="button"
          onClick={openColumns}
          disabled={!allColumns}
          aria-label={
            allColumns && visible && visible.length < allColumns.length
              ? `Columns, ${visible.length} of ${allColumns.length} selected`
              : "Columns"
          }
        >
          Columns
          {allColumns && visible && visible.length < allColumns.length && <span className="callout">{visible.length}</span>}
        </button>
        <button className="btn" type="button" onClick={openFilters} disabled={!allColumns}>
          Filters
        </button>
        <span className="spacer" />
            <button className="btn" type="button" disabled={visible !== null && visible.length === 0} onClick={() => void exportGrid()}>
              Export all
            </button>
      </div>
      {filters.length > 0 && (
        <div className="chips" aria-label="Applied filters">
          {filters.map((filter, index) => (
            <span className="chip" key={`${filter.column}-${filter.op}-${index}`}>
              {filterSQL(filter)}
              <button
                type="button"
                aria-label={`Remove filter ${filterSQL(filter)}`}
                onClick={() => {
                  setFilters(filters.filter((_, item) => item !== index));
                  setOffset(0);
                  setCount(null);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="empty">{error}</p>}
      {page && page.columns.length > 0 && (
        <SelectableTable
          columns={page.columns}
          rows={page.rows}
          clearRows={clearRows}
          filename={`${target.relation}-rows.csv`}
          onRowScope={onRowScope}
          sort={sort}
          onHeaderClick={(name) => {
            setSort((current) => {
              if (!current || current.column !== name) return { column: name, dir: "asc" };
              if (current.dir === "asc") return { column: name, dir: "desc" };
              return null;
            });
          }}
        />
      )}
      <details className="statement">
        <summary>Statement</summary>
        <pre>{page?.sql}</pre>
        <div className="hint">Filter values are parameters. This statement is read-only.</div>
      </details>
      <div className="grid-footer">
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
        <button
          className="btn"
          type="button"
          onClick={() => {
            api<{ count: number }>(config, `/sessions/${sessionId}/browse/count`, {
              method: "POST",
              body: JSON.stringify({ database: target.database, schema: target.schema, relation: target.relation, columns: visible, filters }),
            })
              .then((result) => setCount(result.count))
              .catch((err: Error) => setError(err.message));
          }}
        >
          Count
        </button>
        {count !== null && <span className="meta">Count: {count}</span>}
        <span className="spacer" />
        <span className="meta">{start && end ? `${start}–${end}` : "0 rows"}</span>
        <button className="btn" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
          Previous
        </button>
        <button className="btn" type="button" disabled={!page || page.rows.length < pageSize} onClick={() => setOffset(offset + pageSize)}>
          Next
        </button>
      </div>
      {filtersOpen && allColumns && (
        <div className="scrim" onPointerDown={() => setFiltersOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="filters-title" onPointerDown={(event) => event.stopPropagation()}>
            <h2 id="filters-title">Filters</h2>
            <p className="help">Every condition is combined with AND. For like, type % where you want a wildcard.</p>
            <div className="filter-rows">
              {filterDraft.map((filter, index) => (
                <div className="filter-row" key={index}>
                  <select aria-label="Filter column" value={filter.column} onChange={(event) => updateFilter(index, { ...filter, column: event.target.value })}>
                    {allColumns.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <select aria-label="Filter operator" value={filter.op} onChange={(event) => updateFilter(index, { ...filter, op: event.target.value })}>
                    {filterOps.map((item) => (
                      <option key={item.op} value={item.op}>{item.label}</option>
                    ))}
                  </select>
                  <input
                    aria-label="Filter value"
                    value={filter.value}
                    disabled={!needsFilterValue(filter.op)}
                    onChange={(event) => updateFilter(index, { ...filter, value: event.target.value })}
                  />
                  <button className="btn" type="button" onClick={() => setFilterDraft(filterDraft.filter((_, item) => item !== index))} disabled={filterDraft.length === 1}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="sheet-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setFilterDraft([...filterDraft, { column: allColumns[0] || "", op: "eq", value: "" }])}
              >
                Add filter
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setFilters([]);
                  setOffset(0);
                  setCount(null);
                  setFiltersOpen(false);
                }}
              >
                Clear
              </button>
              <span className="spacer" />
              <button className="btn" type="button" onClick={() => setFiltersOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={!filtersReady(filterDraft)} onClick={applyFilters}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
      {columnsOpen && allColumns && (
        <div className="scrim" onPointerDown={() => setColumnsOpen(false)}>
          <div
            className="sheet narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="columns-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 id="columns-title">Columns</h2>
            <p className="help">Choose which columns to show.</p>
            <div className="column-list">
              {allColumns.map((name) => (
                <label key={name} className="check">
                  <input type="checkbox" checked={picked.includes(name)} onChange={() => toggleColumn(name)} />
                  {name}
                </label>
              ))}
            </div>
            {picked.length === 0 && <p className="help">Select at least one column.</p>}
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={() => setPicked(allColumns)}>
                Select all
              </button>
              <button className="btn" type="button" onClick={() => setPicked([])}>
                Select none
              </button>
              <span className="spacer" />
              <button className="btn" type="button" onClick={() => setColumnsOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={picked.length === 0} onClick={applyColumns}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
