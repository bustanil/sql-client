import { useEffect, useState } from "react";
import { api, loadConfig, type ClientConfig } from "./api";
import { Connections } from "./connections";
import { Workspace, type LiveSession } from "./workspace";

export function App() {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<LiveSession | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: Error) => setError(err.message));
  }, []);

  async function disconnect() {
    if (config && session) {
      await api(config, `/sessions/${session.sessionId}`, { method: "DELETE" });
    }
    setSession(null);
  }

  return (
    <div className="window">
      <header className="titlebar">
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="title">SQL Client</span>
      </header>
      {error && <p className="empty">{error}</p>}
      {config && !session && <Connections config={config} onConnect={setSession} />}
      {config && session && <Workspace session={session} onDisconnect={() => void disconnect()} />}
    </div>
  );
}
