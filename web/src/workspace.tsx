import type { ClientConfig } from "./api";
import { Explorer } from "./explorer";

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
        </div>
        <Explorer config={config} session={session} onSession={onSession} />
      </aside>
      <section className="main-pane">
        <footer className="status">
          <span className="dot" />
          <span>{bits.join(" · ")}</span>
        </footer>
      </section>
    </div>
  );
}
