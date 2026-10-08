import { api, type ClientConfig } from "./api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Explorer } from "./explorer";
import { DataGrid, type GridTarget, type RowScope } from "./grid";
import { DDLForm } from "./ddl";
import { QueryEditor } from "./editor";
import { OverflowTip } from "./overflow";

const sideMin = 240;
const sideDefault = 300;
const sideKey = "sqlc.sidebarWidth";

function readSideWidth() {
  try {
    const saved = Number(localStorage.getItem(sideKey));
    return Number.isFinite(saved) && saved >= sideMin ? saved : sideDefault;
  } catch {
    return sideDefault;
  }
}

function clampSide(clientX: number, workspace: HTMLElement) {
  const bounds = workspace.getBoundingClientRect();
  const max = Math.max(sideMin, bounds.width - 320);
  return Math.round(Math.min(Math.max(clientX - bounds.left, sideMin), max));
}

export type LiveSession = {
  sessionId: string;
  engine: string;
  database: string;
  readOnly: boolean;
  name: string;
  connectionId?: string;
};

export function Workspace({
  config,
  session,
  onSession,
  onDisconnect,
}: {
  config: ClientConfig;
  session: LiveSession;
  onSession: (next: LiveSession) => void;
  onDisconnect: () => void;
}) {
  const [grid, setGrid] = useState<GridTarget | null>(null);
  const [querySession, setQuerySession] = useState<string | null>(null);
  const [ddl, setDDL] = useState<"database" | "table" | null>(null);
  const [schema, setSchema] = useState("public");
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const [toolbarRoot, setToolbarRoot] = useState<HTMLDivElement | null>(null);
  const [rowScope, setRowScope] = useState<RowScope | null>(null);
  const [rowClear, setRowClear] = useState(0);
  const reportRowScope = useCallback((scope: RowScope | null) => setRowScope(scope), []);
  const clearGridRows = useCallback(() => setRowClear((current) => current + 1), []);

  useEffect(() => {
    if (!querySession || !session.database) return;
    void api(config, `/sessions/${querySession}/database`, {
      method: "POST",
      body: JSON.stringify({ database: session.database }),
    }).catch(() => undefined);
  }, [config, querySession, session.database]);
  const dragging = useRef(false);

  function rememberWidth(next: number) {
    setSideWidth(next);
    try {
      localStorage.setItem(sideKey, String(next));
    } catch {
      /* the width still applies for this session */
    }
  }
  const bits = [session.name, session.engine, session.database || "No database", session.readOnly ? "Read-only" : null, "Idle"].filter(Boolean);
  return (
    <div className="workspace">
      <div className="obj-toolbar-slot" ref={setToolbarRoot} />
      <div className="workspace-body">
      <aside className="sidebar" style={{ width: sideWidth }}>
        <div className="side-head">
          <div>
            <OverflowTip className="side-title" text={session.name + (session.readOnly ? " · Read-only" : "")} />
            <div className="meta">{session.engine}</div>
          </div>
          <button className="btn btn-quiet" type="button" onClick={onDisconnect}>
            Disconnect
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              void api<{ sessionId: string }>(config, `/sessions/${session.sessionId}/spawn`, { method: "POST" }).then((opened) => {
                setQuerySession(opened.sessionId);
                setGrid(null);
              });
            }}
          >
            New query
          </button>
        </div>
        <Explorer
          config={config}
          session={session}
          toolbarRoot={toolbarRoot}
          rowScope={rowScope}
          onPick={clearGridRows}
          onSession={onSession}
          onOpen={(target) => {
            setGrid(target);
            setQuerySession(null);
            setDDL(null);
          }}
          onCreate={(kind, nextSchema) => {
            setDDL(kind);
            if (nextSchema) setSchema(nextSchema);
            setQuerySession(null);
            setGrid(null);
          }}
        />
      </aside>
      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={sideMin}
        aria-valuenow={sideWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const workspace = event.currentTarget.parentElement;
          if (!workspace) return;
          setSideWidth(clampSide(event.clientX, workspace));
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          const workspace = event.currentTarget.parentElement;
          if (!workspace) return;
          rememberWidth(clampSide(event.clientX, workspace));
        }}
        onKeyDown={(event) => {
          const workspace = event.currentTarget.parentElement;
          if (!workspace) return;
          const max = Math.max(sideMin, workspace.getBoundingClientRect().width - 320);
          if (event.key === "ArrowLeft") rememberWidth(Math.max(sideMin, sideWidth - 16));
          if (event.key === "ArrowRight") rememberWidth(Math.min(max, sideWidth + 16));
        }}
      />
      <section className="main-pane">
        {ddl && (
          <DDLForm
            config={config}
            sessionId={session.sessionId}
            engine={session.engine}
            schema={schema}
            mode={ddl}
            onCancel={() => setDDL(null)}
            onDone={() => setDDL(null)}
          />
        )}
        {querySession && !ddl && (
          <QueryEditor
            config={config}
            sessionId={querySession}
            connectionId={session.connectionId}
            clearRows={rowClear}
            onRowScope={reportRowScope}
          />
        )}
        {grid && !querySession && (
          <DataGrid config={config} sessionId={session.sessionId} target={grid} clearRows={rowClear} onRowScope={reportRowScope} />
        )}
        <footer className="status">
          <span className="dot" />
          <span>{bits.join(" · ")}</span>
        </footer>
      </section>
      </div>
    </div>
  );
}
