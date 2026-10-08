import { api, type ClientConfig } from "./api";
import { useState } from "react";
import { Explorer } from "./explorer";
import { DataGrid, type GridTarget } from "./grid";
import { QueryEditor } from "./editor";

export type LiveSession = {
  sessionId: string;
  engine: string;
  database: string;
  readOnly: boolean;
  name: string;
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
  const bits = [session.name, session.engine, session.database || "No database", session.readOnly ? "Read-only" : null, "Idle"].filter(Boolean);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="side-head">
          <div>
            <div className="side-title">
              {session.name}
              {session.readOnly ? " · Read-only" : ""}
            </div>
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
        <Explorer config={config} session={session} onSession={onSession} onOpen={(target) => { setGrid(target); setQuerySession(null); }} />
      </aside>
      <section className="main-pane">
        {querySession && <QueryEditor config={config} sessionId={querySession} />}
        {grid && !querySession && <DataGrid config={config} sessionId={session.sessionId} target={grid} />}
        <footer className="status">
          <span className="dot" />
          <span>{bits.join(" · ")}</span>
        </footer>
      </section>
    </div>
  );
}
