import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, RequestError, type ClientConfig, type FieldError } from "./api";
import { saveCSV } from "./csv";
import { SelectableTable, type RowScope } from "./selectable";
import { columnHasZone, columnKind, draftDiffers, type Cell, type EditDraft, type FieldKind } from "./values";

export type { RowScope };

type ColumnInfo = { name: string; type: string; nullable: boolean; default?: string; primaryKey: boolean };

type Page = {
  sql: string;
  columns: string[];
  columnInfo: ColumnInfo[];
  identityColumns: string[];
  identity: Array<Array<string | null>>;
  rows: Cell[][];
  display?: Array<Array<string | null>>;
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

type Update = { row: number; identity: Record<string, string | null>; changes: Record<string, string | null> };
type Delete = { row: number; identity: Record<string, string | null> };

export function DataGrid({
  config,
  sessionId,
  target,
  clearRows,
  onRowScope,
  readOnly = false,
}: {
  config: ClientConfig;
  sessionId: string;
  target: GridTarget;
  clearRows: number;
  onRowScope?: (scope: RowScope | null) => void;
  readOnly?: boolean;
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
  const [reloadCount, setReloadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, EditDraft>>>({});
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [cellErrors, setCellErrors] = useState<Record<string, Record<string, string>>>({});
  const [commitError, setCommitError] = useState("");
  const [commitDetails, setCommitDetails] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const committingRef = useRef(false);

  useEffect(() => {
    setOffset(0);
    setAllColumns(null);
    setVisible(null);
    setFilters([]);
    setSort(null);
    setCount(null);
    setColumnsOpen(false);
    setEdits({});
    setDeleted(new Set());
    setCellErrors({});
    setCommitError("");
    setCommitDetails([]);
  }, [target.relation, target.schema, target.database]);

  useEffect(() => {
    if (visible && visible.length === 0) {
      setPage({ sql: "", columns: [], columnInfo: [], identityColumns: [], identity: [], rows: [], display: [], window: { start: 0, end: 0 } });
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, sessionId, target.database, target.schema, target.relation, pageSize, offset, filters, sort, visible, reloadCount]);

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

  const columnKinds = useMemo(() => {
    const out: Record<string, FieldKind> = {};
    for (const info of page?.columnInfo || []) out[info.name] = columnKind(info.type);
    return out;
  }, [page]);

  const columnZones = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const info of page?.columnInfo || []) out[info.name] = columnHasZone(info.type);
    return out;
  }, [page]);

  const columnNullable = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const info of page?.columnInfo || []) out[info.name] = info.nullable;
    return out;
  }, [page]);

  function rowKeyAt(index: number): string | null {
    if (!page || page.identityColumns.length === 0) return null;
    const identity = page.identity[index];
    if (!identity) return null;
    return JSON.stringify(identity);
  }

  // Use the exact text from the server for display and edits. The typed rows
  // can lose precision on a bigint above the JavaScript safe integer.
  const rowValues = page?.display ?? page?.rows ?? [];

  const rowKeys = useMemo(() => (page ? rowValues.map((_, index) => rowKeyAt(index) ?? `row:${index}`) : []), [page, rowValues]);

  const canEdit = !readOnly && !!page && (page.identityColumns?.length || 0) > 0;

  const dirtyCount = useMemo(() => {
    if (!page) return 0;
    let total = 0;
    rowValues.forEach((row, index) => {
      const key = rowKeyAt(index);
      const rowDrafts = key ? edits[key] : undefined;
      if (!rowDrafts) return;
      for (const [column, draft] of Object.entries(rowDrafts)) {
        const cellIndex = page.columns.indexOf(column);
        if (cellIndex < 0) continue;
        if (draftDiffers(row[cellIndex], draft, columnKinds[column] || "text", columnZones[column] || false)) total += 1;
      }
    });
    return total;
  }, [page, rowValues, edits, columnKinds, columnZones]);

  const hasPending = dirtyCount > 0 || deleted.size > 0;
  const selectedHasDeleted = selectedRows.some((index) => {
    const key = rowKeyAt(index);
    return key ? deleted.has(key) : false;
  });

  const handleSelection = useCallback((next: number[]) => setSelectedRows(next), []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function clearPending() {
    setEdits({});
    setDeleted(new Set());
    setCellErrors({});
    setCommitError("");
    setCommitDetails([]);
  }

  function confirmDiscard() {
    if (!hasPending) return true;
    if (!window.confirm("Discard row changes that are not committed?")) return false;
    clearPending();
    return true;
  }

  function setDraft(index: number, column: string, next: EditDraft) {
    if (!page || committingRef.current) return;
    const key = rowKeyAt(index);
    const cellIndex = page.columns.indexOf(column);
    if (!key || cellIndex < 0) return;
    setCommitError("");
    setCommitDetails([]);
    const dirty = draftDiffers(rowValues[index]?.[cellIndex] ?? null, next, columnKinds[column] || "text", columnZones[column] || false);
    setEdits((current) => {
      const rowDrafts = { ...(current[key] || {}) };
      if (dirty) rowDrafts[column] = next;
      else delete rowDrafts[column];
      const nextEdits = { ...current };
      if (Object.keys(rowDrafts).length === 0) delete nextEdits[key];
      else nextEdits[key] = rowDrafts;
      return nextEdits;
    });
    setCellErrors((current) => {
      if (!current[key]?.[column]) return current;
      const rowErrors = { ...current[key] };
      delete rowErrors[column];
      const nextErrors = { ...current };
      if (Object.keys(rowErrors).length === 0) delete nextErrors[key];
      else nextErrors[key] = rowErrors;
      return nextErrors;
    });
  }

  function identityAt(index: number): Record<string, string | null> {
    const identity: Record<string, string | null> = {};
    if (!page) return identity;
    page.identityColumns.forEach((name, column) => {
      identity[name] = page.identity[index]?.[column] ?? null;
    });
    return identity;
  }

  function markDeleted() {
    if (!canEdit) return;
    const keys = selectedRows.map((index) => rowKeyAt(index)).filter((key): key is string => key !== null);
    if (keys.length === 0) return;
    const removed = new Set(keys);
    setDeleted((current) => new Set([...current, ...removed]));
    setEdits((current) => {
      const next = { ...current };
      for (const key of removed) delete next[key];
      return next;
    });
    setCellErrors((current) => {
      const next = { ...current };
      for (const key of removed) delete next[key];
      return next;
    });
    setCommitError("");
    setCommitDetails([]);
  }

  function restoreDeleted() {
    const keys = selectedRows.map((index) => rowKeyAt(index)).filter((key): key is string => key !== null && deleted.has(key));
    if (keys.length === 0) return;
    const restored = new Set(keys);
    setDeleted((current) => {
      const next = new Set(current);
      for (const key of restored) next.delete(key);
      return next;
    });
    setCommitError("");
    setCommitDetails([]);
  }

  async function commit() {
    if (!page || !canEdit || !hasPending || committingRef.current) return;
    const updates: Update[] = [];
    const deletes: Delete[] = [];
    const keysByRow = new Map<number, string>();
    rowValues.forEach((row, index) => {
      const key = rowKeyAt(index);
      if (!key) return;
      if (deleted.has(key)) {
        keysByRow.set(index, key);
        deletes.push({ row: index, identity: identityAt(index) });
        return;
      }
      const rowDrafts = edits[key];
      if (!rowDrafts) return;
      const changes: Record<string, string | null> = {};
      for (const [column, draft] of Object.entries(rowDrafts)) {
        const cellIndex = page.columns.indexOf(column);
        if (cellIndex < 0) continue;
        if (!draftDiffers(row[cellIndex], draft, columnKinds[column] || "text", columnZones[column] || false)) continue;
        changes[column] = draft.isNull ? null : draft.text;
      }
      if (Object.keys(changes).length > 0) {
        keysByRow.set(index, key);
        updates.push({ row: index, identity: identityAt(index), changes });
      }
    });
    if (updates.length === 0 && deletes.length === 0) {
      showToast("Nothing to commit");
      return;
    }
    committingRef.current = true;
    setCommitting(true);
    setCommitError("");
    setCommitDetails([]);
    setCellErrors({});
    try {
      const result = await api<{ updated: number; deleted: number }>(config, `/sessions/${sessionId}/rows/commit`, {
        method: "POST",
        body: JSON.stringify({
          database: target.database,
          schema: target.schema,
          relation: target.relation,
          updates,
          deletes,
        }),
      });
      clearPending();
      setCount(null);
      setReloadCount((current) => current + 1);
      showToast(`Committed ${result.updated} update${result.updated === 1 ? "" : "s"} and ${result.deleted} delete${result.deleted === 1 ? "" : "s"}`);
    } catch (err) {
      // Keep every dirty edit and pending delete. Only the error markers change.
      if (err instanceof RequestError && Array.isArray(err.body?.errors)) {
        const next: Record<string, Record<string, string>> = {};
        const details = new Set<string>();
        for (const field of err.body.errors as FieldError[]) {
          details.add(field.column ? `${field.column}: ${field.message}` : field.message);
          if (field.row < 0 || !field.column) continue;
          const key = keysByRow.get(field.row);
          if (!key) continue;
          next[key] = { ...(next[key] || {}), [field.column]: field.message };
        }
        setCellErrors(next);
        setCommitDetails([...details]);
      }
      setCommitError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      committingRef.current = false;
      setCommitting(false);
    }
  }

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
    if (!confirmDiscard()) return;
    setFilters(filterDraft);
    setOffset(0);
    setCount(null);
    setFiltersOpen(false);
  }

  function clearFilters() {
    if (!confirmDiscard()) return;
    setFilters([]);
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
    if (!confirmDiscard()) return;
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
        <button
          className="btn"
          type="button"
          disabled={loading}
          onClick={() => {
            if (!confirmDiscard()) return;
            setCount(null);
            setReloadCount((current) => current + 1);
          }}
        >
          Reload
        </button>
        {canEdit && (
          <>
            <button
              className="btn"
              type="button"
              disabled={selectedRows.length === 0 || committing}
              title={selectedRows.length === 0 ? "Select one or more rows first" : "Mark selected rows for deletion"}
              onClick={markDeleted}
            >
              Delete
            </button>
            {deleted.size > 0 && (
              <button className="btn" type="button" disabled={!selectedHasDeleted || committing} onClick={restoreDeleted}>
                Restore
              </button>
            )}
            <button className="btn btn-primary" type="button" disabled={!hasPending || committing} onClick={() => void commit()}>
              {committing ? "Committing…" : "Commit"}
            </button>
            {hasPending && (
              <button className="btn" type="button" disabled={committing} onClick={clearPending}>
                Discard
              </button>
            )}
            {hasPending && (
              <span className="meta row-pending">
                {dirtyCount} edited · {deleted.size} to delete
              </span>
            )}
            {selectedRows.length > 0 && <span className="meta">{selectedRows.length} selected</span>}
          </>
        )}
        {!readOnly && page && page.identityColumns.length === 0 && <span className="meta">No primary key · rows cannot be edited</span>}
        {readOnly && <span className="meta">Read-only</span>}
        <span className="spacer" />
        <button className="btn" type="button" disabled={visible !== null && visible.length === 0} onClick={() => void exportGrid()}>
          Export all
        </button>
      </div>
      {commitError && (
        <div className="row-error" role="alert">
          <span>{commitError}</span>
          {commitDetails.length > 0 && (
            <ul>
              {commitDetails.slice(0, 8).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {filters.length > 0 && (
        <div className="chips" aria-label="Applied filters">
          {filters.map((filter, index) => (
            <span className="chip" key={`${filter.column}-${filter.op}-${index}`}>
              {filterSQL(filter)}
              <button
                type="button"
                aria-label={`Remove filter ${filterSQL(filter)}`}
                onClick={() => {
                  if (!confirmDiscard()) return;
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
          rows={rowValues}
          clearRows={clearRows}
          filename={`${target.relation}-rows.csv`}
          onRowScope={onRowScope}
          sort={sort}
          onHeaderClick={(name) => {
            if (!confirmDiscard()) return;
            setSort((current) => {
              if (!current || current.column !== name) return { column: name, dir: "asc" };
              if (current.dir === "asc") return { column: name, dir: "desc" };
              return null;
            });
          }}
          editable={canEdit && !committing}
          rowKeys={rowKeys}
          edits={edits}
          errors={cellErrors}
          deleted={deleted}
          columnKinds={columnKinds}
          columnZones={columnZones}
          columnNullable={columnNullable}
          onEdit={setDraft}
          onSelectionChange={handleSelection}
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
              if (!confirmDiscard()) return;
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
        <button
          className="btn"
          type="button"
          disabled={offset === 0}
          onClick={() => {
            if (!confirmDiscard()) return;
            setOffset(Math.max(0, offset - pageSize));
          }}
        >
          Previous
        </button>
        <button
          className="btn"
          type="button"
          disabled={!page || rowValues.length < pageSize}
          onClick={() => {
            if (!confirmDiscard()) return;
            setOffset(offset + pageSize);
          }}
        >
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
              <button className="btn" type="button" onClick={clearFilters}>
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
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
