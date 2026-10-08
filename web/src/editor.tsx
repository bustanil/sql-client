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
  queryId?: string;
  type: string;
};

export function QueryEditor({
  config,
  sessionId,
  connectionId,
}: {
  config: ClientConfig;
  sessionId: string;
  connectionId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const abort = useRef<AbortController | null>(null);
  const queryId = useRef("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [maxRows, setMaxRows] = useState(1000);
  const [timeoutSec, setTimeoutSec] = useState(30);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<Array<{ sql: string; ok: boolean; error?: string }>>([]);

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
    setRunning(true);
    abort.current = new AbortController();
    try {
      const res = await fetch(`${config.origin}/sessions/${sessionId}/queries`, {
        method: "POST",
        signal: abort.current.signal,
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlText, maxRows, timeoutSec }),
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
          if (event.queryId) queryId.current = event.queryId;
          if (event.type === "error") setError(event.message || "Query failed");
          if (event.type === "canceled") setError("Canceled");
          if (event.type === "result") setResult(event);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") setError("Canceled");
      else setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setRunning(false);
    }
  }

  async function cancel() {
    abort.current?.abort();
    if (!queryId.current) return;
    await fetch(`${config.origin}/sessions/${sessionId}/queries/${queryId.current}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
    });
  }

  async function showHistory() {
    if (!connectionId) return;
    const res = await fetch(`${config.origin}/connections/${connectionId}/history`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    setHistory(await res.json());
  }

  function format() {
    const editor = view.current;
    if (!editor) return;
    const next = formatSQL(editor.state.doc.toString());
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
  }

  function loadHistory(sqlText: string) {
    view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: sqlText } });
    setHistory([]);
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
          Timeout
          <select aria-label="Statement timeout" value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value))}>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
            <option value={300}>5 minutes</option>
            <option value={0}>No timeout</option>
          </select>
        </label>
        <button className="btn" type="button" disabled={!running} onClick={() => void cancel()}>
          Cancel
        </button>
        <label className="meta">
          Rows
          <select aria-label="Result cap" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))}>
            <option value={1000}>1000</option>
            <option value={5000}>5000</option>
          </select>
        </label>
        <button className="btn" type="button" onClick={() => void showHistory()}>
          History
        </button>
      </div>
      {history.length > 0 && (
        <div className="history">
          {history.map((item, index) => (
            <button key={index} type="button" onClick={() => loadHistory(item.sql)}>
              {item.ok ? "ok" : item.error} · {item.sql}
            </button>
          ))}
        </div>
      )}
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
