import { useEffect, useRef, useState, type MouseEvent } from "react";
import { rowsToCSV, saveCSV } from "./csv";

export type RowScope = {
  count: number;
  exportCSV: () => void;
};

type Cell = string | number | boolean | null;

export function SelectableTable({
  columns,
  rows,
  clearRows,
  filename,
  onRowScope,
  onHeaderClick,
  sort,
}: {
  columns: string[];
  rows: Cell[][];
  clearRows: number;
  filename: string;
  onRowScope?: (scope: RowScope | null) => void;
  onHeaderClick?: (name: string) => void;
  sort?: { column: string; dir: "asc" | "desc" } | null;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState(0);
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const copyArmed = useRef(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    setSelected([]);
    setAnchor(0);
    setActiveCell(null);
  }, [clearRows, columns, rows]);

  useEffect(() => {
    setActiveCell((current) => {
      if (!current || selected.includes(current.row)) return current;
      return null;
    });
  }, [selected]);

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
            {rows.map((row, index) => (
              <tr
                key={index}
                aria-selected={selected.includes(index)}
                onClick={(event) => {
                  const cell = event.target instanceof HTMLTableCellElement ? event.target : event.target instanceof Node ? event.target.parentElement : null;
                  const column = cell instanceof HTMLTableCellElement ? cell.cellIndex : 0;
                  onRowClick(index, column, event);
                }}
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={[cell === null ? "nil" : "", activeCell?.row === index && activeCell.column === cellIndex && selected.includes(index) ? "cell-active" : ""].filter(Boolean).join(" ")}
                    onMouseDown={(event) => {
                      if (event.detail === 1) {
                        copyArmed.current = activeCell?.row === index && activeCell.column === cellIndex && selected.includes(index);
                      }
                    }}
                    onDoubleClick={() => {
                      if (!selected.includes(index)) return;
                      setActiveCell({ row: index, column: cellIndex });
                      copyCell(cell);
                    }}
                  >
                    {cell === null ? "NULL" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
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
