export type LiveSession = {
  sessionId: string;
  engine: string;
  database: string;
  readOnly: boolean;
  name: string;
};

export function Workspace({
  session,
  onDisconnect,
}: {
  session: LiveSession;
  onDisconnect: () => void;
}) {
  const bits = [session.name, session.engine, session.database || "No database", session.readOnly ? "Read-only" : null, "Idle"].filter(Boolean);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="side-head">
          <div>
            <div className="side-title">{session.name}{session.readOnly ? " · Read-only" : ""}</div>
            <div className="meta">{session.engine}</div>
          </div>
          <button className="btn btn-quiet" type="button" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
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
