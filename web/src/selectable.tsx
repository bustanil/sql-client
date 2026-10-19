import { useEffect, useRef, useState, type MouseEvent } from "react";
import { rowsToCSV, saveCSV } from "./csv";
import { draftDiffers, displayValue, pickerSpec, valueFromPicker, type Cell, type EditDraft, type FieldKind } from "./values";

export type RowScope = {
  count: number;
  exportCSV: () => void;
};

export function SelectableTable({
  columns,
  rows,
  clearRows,
  filename,
  onRowScope,
  onHeaderClick,
  sort,
  editable = false,
  rowKeys,
  edits,
  errors,
  deleted,
  columnKinds,
  columnZones,
  columnNullable,
  onEdit,
  onSelectionChange,
}: {
  columns: string[];
  rows: Cell[][];
  clearRows: number;
  filename: string;
  onRowScope?: (scope: RowScope | null) => void;
  onHeaderClick?: (name: string) => void;
  sort?: { column: string; dir: "asc" | "desc" } | null;
  editable?: boolean;
  rowKeys?: string[];
  edits?: Record<string, Record<string, EditDraft>>;
  errors?: Record<string, Record<string, string>>;
  deleted?: Set<string>;
  columnKinds?: Record<string, FieldKind>;
  columnZones?: Record<string, boolean>;
  columnNullable?: Record<string, boolean>;
  onEdit?: (row: number, column: string, draft: EditDraft) => void;
  onSelectionChange?: (selected: number[]) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState(0);
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(null);
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const copyArmed = useRef(false);
  const clearTimer = useRef<number | null>(null);
  const editingCell = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    setSelected([]);
    setAnchor(0);
    setActiveCell(null);
    setEditing(null);
  }, [clearRows, columns, rows]);

  useEffect(() => {
    setActiveCell((current) => {
      if (!current || selected.includes(current.row)) return current;
      return null;
    });
  }, [selected]);

  useEffect(() => {
    onSelectionChange?.(selected);
  }, [onSelectionChange, selected]);

  useEffect(() => {
    if (!editing) return;
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && editingCell.current?.contains(target)) return;
      setEditing(null);
    }
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [editing]);

  useEffect(() => {
    if (!editing || !rowKeys) return;
    const rowKey = rowKeys[editing.row];
    if (rowKey && deleted?.has(rowKey)) setEditing(null);
  }, [deleted, editing, rowKeys]);

  useEffect(() => {
    if (!editable) setEditing(null);
  }, [editable]);

  useEffect(() => {
    if (!onRowScope) return;
    if (selected.length === 0) {
      onRowScope(null);
      return;
    }
    const picked = [...selected].sort((a, b) => a - b).flatMap((index) => {
      const row = rows[index];
      return row ? [row] : [];
    });
    onRowScope({
      count: picked.length,
      exportCSV: () => {
        void saveCSV(filename, rowsToCSV(columns, picked));
      },
    });
  }, [onRowScope, columns, rows, selected, filename]);

  useEffect(() => {
    return () => onRowScope?.(null);
  }, [onRowScope]);

  function rowKey(index: number) {
    return rowKeys?.[index] ?? `row:${index}`;
  }

  function selectRow(index: number, extend: boolean, toggle: boolean) {
    if (extend) {
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      const range: number[] = [];
      for (let i = from; i <= to; i++) range.push(i);
      if (toggle) {
        const merged = new Set([...selected, ...range]);
        setSelected([...merged].sort((a, b) => a - b));
      } else {
        setSelected(range);
      }
      return;
    }
    setAnchor(index);
    if (toggle) {
      setSelected(selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index].sort((a, b) => a - b));
      return;
    }
    if (selected.length === 1 && selected[0] === index) {
      setSelected([]);
      return;
    }
    setSelected([index]);
  }

  function beginEdit(index: number, column: number) {
    if (!editable || !onEdit) return;
    if (deleted?.has(rowKey(index))) return;
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setActiveCell({ row: index, column });
    setEditing({ row: index, column });
  }

  function onRowClick(index: number, column: number, event: MouseEvent<Element>) {
    if (event.detail > 1) return;
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    const extend = event.shiftKey;
    const toggle = event.metaKey || event.ctrlKey;
    const sameCell = activeCell?.row === index && activeCell.column === column;
    if (!extend && !toggle && selected.includes(index) && !sameCell) {
      setActiveCell({ row: index, column });
      return;
    }
    if (!extend && !toggle && selected.length === 1 && selected[0] === index) {
      clearTimer.current = window.setTimeout(() => {
        clearTimer.current = null;
        setSelected([]);
      }, 250);
      return;
    }
    setActiveCell({ row: index, column });
    selectRow(index, extend, toggle);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2000);
  }

  function copyCell(value: Cell) {
    if (!copyArmed.current) return;
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    const text = value === null ? "" : String(value);
    void writeClipboard(text).then(
      () => showToast("Copied to clipboard"),
      () => showToast("Could not copy"),
    );
  }

  return (
    <>
      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((name) => (
                <th key={name} onClick={onHeaderClick ? () => onHeaderClick(name) : undefined}>
                  {name}
                  {sort?.column === name ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = rowKey(index);
              const rowDeleted = deleted?.has(key) || false;
              return (
                <tr
                  key={index}
                  className={rowDeleted ? "row-deleted" : undefined}
                  aria-selected={selected.includes(index)}
                  onClick={(event) => {
                    const cell = event.target instanceof HTMLTableCellElement ? event.target : event.target instanceof Node ? event.target.parentElement : null;
                    const column = cell instanceof HTMLTableCellElement ? cell.cellIndex : 0;
                    onRowClick(index, column, event);
                  }}
                >
                  {row.map((cell, cellIndex) => {
                    const name = columns[cellIndex];
                    const kind = columnKinds?.[name] || "text";
                    const hasZone = columnZones?.[name] || false;
                    const draft = edits?.[key]?.[name];
                    const dirty = draft ? draftDiffers(cell, draft, kind, hasZone) : false;
                    const error = errors?.[key]?.[name];
                    const isEditing = editing?.row === index && editing.column === cellIndex;
                    const display = draft
                      ? { text: draft.isNull ? "NULL" : draft.text, isNull: draft.isNull }
                      : { text: cell === null ? "NULL" : displayValue(kind, String(cell)), isNull: cell === null };
                    return (
                      <td
                        key={cellIndex}
                        ref={isEditing ? (node) => { editingCell.current = node; } : undefined}
                        title={error}
                        className={[
                          display.isNull ? "nil" : "",
                          dirty ? "cell-dirty" : "",
                          error ? "cell-invalid" : "",
                          isEditing ? "cell-editing" : "",
                          activeCell?.row === index && activeCell.column === cellIndex && selected.includes(index) ? "cell-active" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                        onMouseDown={(event) => {
                          if (event.detail === 1 && !isEditing) {
                            copyArmed.current = activeCell?.row === index && activeCell.column === cellIndex && selected.includes(index);
                          }
                        }}
                        onDoubleClick={(event) => {
                          if (isEditing) {
                            event.stopPropagation();
                            return;
                          }
                          if (editable) {
                            if (!selected.includes(index)) selectRow(index, false, false);
                            beginEdit(index, cellIndex);
                            return;
                          }
                          if (!selected.includes(index)) return;
                          setActiveCell({ row: index, column: cellIndex });
                          copyCell(cell);
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            column={name}
                            kind={kind}
                            hasZone={hasZone}
                            nullable={columnNullable?.[name] ?? true}
                            original={cell}
                            draft={draft}
                            error={error}
                            onDraft={(next) => onEdit?.(index, name, next)}
                            onDone={() => setEditing(null)}
                          />
                        ) : (
                          display.text
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function CellEditor({
  column,
  kind,
  hasZone,
  nullable,
  original,
  draft,
  error,
  onDraft,
  onDone,
}: {
  column: string;
  kind: FieldKind;
  hasZone: boolean;
  nullable: boolean;
  original: Cell;
  draft?: EditDraft;
  error?: string;
  onDraft: (draft: EditDraft) => void;
  onDone: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const text = draft ? draft.text : original === null ? "" : displayValue(kind, String(original));
  const isNull = draft?.isNull || false;
  const spec = pickerSpec(kind, isNull ? "" : text);
  const pickerLabel = kind === "date" ? "Open date picker" : kind === "time" ? "Open time picker" : "Open date and time picker";
  const pickerTitle = kind === "date" ? "Pick a date" : kind === "time" ? "Pick a time" : "Pick a date and time";

  function openPicker() {
    const input = picker.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.focus();
    } catch {
      input.focus();
    }
  }

  return (
    <div className="cell-editor" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <input
        ref={textInput}
        className="cell-text"
        autoFocus
        aria-label={`${column} value`}
        value={isNull ? "" : text}
        onChange={(event) => onDraft({ text: event.target.value, isNull: false })}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {nullable && (
        <button
          className="cell-null"
          type="button"
          aria-pressed={isNull}
          title={isNull ? "Replace NULL with a value" : "Set NULL"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            onDraft(
              isNull
                ? { text: original === null ? "" : displayValue(kind, String(original)), isNull: false }
                : { text: "", isNull: true },
            )
          }
        >
          NULL
        </button>
      )}
      {spec && (
        <span className="cell-date-wrap">
          <button
            className="cell-date"
            type="button"
            aria-label={`${pickerLabel} for ${column}`}
            title={pickerTitle}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openPicker}
          >
            <CalendarIcon />
          </button>
          <input
            ref={picker}
            className="cell-date-native"
            type={spec.type}
            step={spec.type === "datetime-local" ? 1 : undefined}
            value={spec.value}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              onDraft({
                text: valueFromPicker(kind, event.target.value, original === null ? "" : String(original), hasZone),
                isNull: false,
              });
              textInput.current?.focus();
            }}
          />
        </span>
      )}
      {error && <span className="cell-error-dot" title={error} aria-label={error} role="img" />}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M5 1.5V4M11 1.5V4" />
    </svg>
  );
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy failed");
  }
}
