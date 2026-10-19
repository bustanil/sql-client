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

type WorkspaceTab = { id: string; sessionId: string; title: string } & (
  | { kind: "query" }
  | { kind: "data"; target: GridTarget }
);

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
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabError, setTabError] = useState("");
  const [ddl, setDDL] = useState<"database" | "table" | null>(null);
  const queryCount = useRef(0);
  const dataCount = useRef(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const pendingData = useRef(new Set<string>());
  const mounted = useRef(true);
  const [schema, setSchema] = useState("public");
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const [toolbarRoot, setToolbarRoot] = useState<HTMLDivElement | null>(null);
  const [rowScope, setRowScope] = useState<RowScope | null>(null);
  const [rowClear, setRowClear] = useState(0);
  const reportRowScope = useCallback((scope: RowScope | null) => setRowScope(scope), []);
  const clearGridRows = useCallback(() => setRowClear((current) => current + 1), []);

  useEffect(() => {
    if (!session.database) return;
    for (const tab of tabsRef.current) {
      if (tab.kind !== "query") continue;
      void api(config, `/sessions/${tab.sessionId}/database`, {
        method: "POST",
        body: JSON.stringify({ database: session.database }),
      }).catch(() => undefined);
    }
  }, [config, session.database]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const tab of tabsRef.current) {
        void api(config, `/sessions/${tab.sessionId}`, { method: "DELETE" }).catch(() => undefined);
      }
    };
  }, [config]);

  async function newQuery() {
    queryCount.current += 1;
    const number = queryCount.current;
    const id = `query-${number}`;
    setTabError("");
    try {
      const opened = await api<{ sessionId: string; connectionId?: string }>(config, `/sessions/${session.sessionId}/spawn`, { method: "POST" });
      if (!mounted.current) {
        void api(config, `/sessions/${opened.sessionId}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      if (!session.connectionId && opened.connectionId) onSession({ ...session, connectionId: opened.connectionId });
      setTabs((prev) => [...prev, { kind: "query", id, sessionId: opened.sessionId, title: `Query ${number}` }]);
      selectTab(id);
    } catch (err) {
      if (mounted.current) setTabError(err instanceof Error ? err.message : "Could not open query");
    }
  }

  async function openData(target: GridTarget) {
    const nextTarget = { ...target, database: target.database || session.database };
    const targetKey = JSON.stringify([nextTarget.database, nextTarget.schema || "", nextTarget.relation]);
    setTabError("");
    const existing = tabsRef.current.find((tab) => tab.kind === "data"
      && tab.target.database === nextTarget.database
      && (tab.target.schema || "") === (nextTarget.schema || "")
      && tab.target.relation === nextTarget.relation);
    if (existing) {
      selectTab(existing.id);
      return;
    }
    if (pendingData.current.has(targetKey)) return;
    pendingData.current.add(targetKey);
    dataCount.current += 1;
    const id = `data-${dataCount.current}`;
    let sessionId: string | undefined;
    try {
      const opened = await api<{ sessionId: string; database: string }>(config, `/sessions/${session.sessionId}/spawn`, { method: "POST" });
      sessionId = opened.sessionId;
      if (nextTarget.database && opened.database !== nextTarget.database) {
        await api(config, `/sessions/${sessionId}/database`, {
          method: "POST",
          body: JSON.stringify({ database: nextTarget.database }),
        });
      }
      if (!mounted.current) {
        void api(config, `/sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      setTabs((prev) => [...prev, { kind: "data", id, sessionId: opened.sessionId, title: target.relation, target: nextTarget }]);
      selectTab(id);
    } catch (err) {
      if (sessionId) void api(config, `/sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
      if (mounted.current) setTabError(err instanceof Error ? err.message : "Could not open data");
    } finally {
      pendingData.current.delete(targetKey);
    }
  }

  function selectTab(id: string) {
    setActiveTab(id);
    setDDL(null);
    setRowScope(null);
  }

  function closeTab(id: string) {
    const tab = tabs.find((item) => item.id === id);
    const rest = tabs.filter((item) => item.id !== id);
    setTabs(rest);
    setActiveTab((current) => (current === id ? rest.at(-1)?.id ?? null : current));
    if (activeTab === id) setRowScope(null);
    if (tab) void api(config, `/sessions/${tab.sessionId}`, { method: "DELETE" }).catch(() => undefined);
  }
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
          <button className="btn btn-quiet btn-icon" type="button" aria-label="Disconnect" aria-describedby="disconnect-tooltip" onClick={onDisconnect}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 11 5 14a3.54 3.54 0 0 0 5 5l3-3ZM11 8l3-3a3.54 3.54 0 0 1 5 5l-3 3ZM9 12l2-2M12 15l2-2M5 19l-3 3M19 5l3-3" />
            </svg>
            <span className="button-tooltip" id="disconnect-tooltip" role="tooltip">Disconnect</span>
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void newQuery()}
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
          onOpen={(target) => void openData(target)}
          onCreate={(kind, nextSchema) => {
            setDDL(kind);
            if (nextSchema) setSchema(nextSchema);
            setActiveTab(null);
            setRowScope(null);
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
        {tabs.length > 0 && (
          <div className="tabbar" role="tablist" aria-label="Workspace tabs">
            {tabs.map((tab) => (
              <div key={tab.id} className={activeTab === tab.id ? "tab active" : "tab"}>
                <button className="tab-main" type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`pane-${tab.id}`} aria-selected={activeTab === tab.id} title={tab.kind === "data" ? [tab.target.database, tab.target.schema, tab.title].filter(Boolean).join(".") : tab.title} onClick={() => selectTab(tab.id)}>
                  <TabIcon kind={tab.kind} />
                  <span className="tab-title">{tab.title}</span>
                </button>
                <button className="tab-close" type="button" aria-label={`Close ${tab.title}`} onClick={() => closeTab(tab.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {tabError && <p className="empty" role="alert">{tabError}</p>}
        {ddl && activeTab === null && (
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
        <div className="tab-stack" hidden={activeTab === null}>
          {tabs.map((tab) => (
            <div key={tab.id} id={`pane-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} className={activeTab === tab.id ? "tab-pane active" : "tab-pane"}>
              {tab.kind === "query" ? <QueryEditor
                config={config}
                sessionId={tab.sessionId}
                connectionId={session.connectionId}
                clearRows={rowClear}
                onRowScope={reportRowScope}
                active={activeTab === tab.id}
              /> : <DataGrid
                config={config}
                sessionId={tab.sessionId}
                target={tab.target}
                clearRows={rowClear}
                readOnly={session.readOnly}
                onRowScope={activeTab === tab.id ? reportRowScope : undefined}
              />}
            </div>
          ))}
        </div>
        <footer className="status">
          <span className="dot" />
          <span>{bits.join(" · ")}</span>
        </footer>
      </section>
      </div>
    </div>
  );
}

function TabIcon({ kind }: { kind: WorkspaceTab["kind"] }) {
  return (
    <svg className={`tab-icon ${kind}`} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "query" ? (
        <>
          <path d="m5 4-3 4 3 4m6-8 3 4-3 4M9 3 7 13" />
        </>
      ) : (
        <>
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M2 6h12M2 10h12M6 6v7.5" />
        </>
      )}
    </svg>
  );
}
