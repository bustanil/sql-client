import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap } from "@codemirror/commands";
import type { ClientConfig } from "./api";
import { formatSQL } from "./format";

type Result = {
  columns?: string[];
  rows?: Array<Array<string | number | boolean | null>>;
  rowsAffected?: number;
  truncated?: boolean;
  elapsedMs?: number;
  messages?: string[];
  message?: string;
  position?: number;
  type: string;
};

export function QueryEditor({ config, sessionId }: { config: ClientConfig; sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [maxRows, setMaxRows] = useState(1000);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      state: EditorState.create({
        doc: "select 1;",
        extensions: [sql(), keymap.of(defaultKeymap), EditorView.lineWrapping],
      }),
      parent: host.current,
    });
    view.current = editor;
    return () => editor.destroy();
  }, []);

  async function run() {
    const sqlText = view.current?.state.doc.toString() || "";
    setError("");
    setResult(null);
    const res = await fetch(`${config.origin}/sessions/${sessionId}/queries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: sqlText, maxRows }),
    });
    if (!res.ok || !res.body) {
      setError(await res.text());
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Result;
        if (event.type === "error") setError(event.message || "Query failed");
        if (event.type === "result") setResult(event);
      }
    }
  }

  function format() {
    const editor = view.current;
    if (!editor) return;
    const next = formatSQL(editor.state.doc.toString());
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
  }

  return (
    <div className="grid-pane">
      <div className="toolbar">
        <button className="btn btn-primary" type="button" onClick={() => void run()}>
          Run
        </button>
        <button className="btn" type="button" onClick={format}>
          Format
        </button>
        <label className="meta">
          Rows
          <select aria-label="Result cap" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))}>
            <option value={1000}>1000</option>
            <option value={5000}>5000</option>
          </select>
        </label>
      </div>
      <div className="editor-host" ref={host} />
      {error && <div className="error-box">{error}</div>}
      {result && (
        <>
          <div className="meta result-meta">
            {(result.messages || []).join(" · ")}
            {result.truncated ? " · truncated" : ""}
            {result.elapsedMs != null ? ` · ${result.elapsedMs} ms` : ""}
          </div>
          {result.columns && result.columns.length > 0 && (
            <div className="grid-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    {result.columns.map((name) => (
                      <th key={name}>{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.rows || []).map((row, index) => (
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
        </>
      )}
    </div>
  );
}
