import { useEffect, useState } from "react";
import { api, loadConfig, type ClientConfig } from "./api";

export function App() {
  const [status, setStatus] = useState("Starting…");

  useEffect(() => {
    let cancelled = false;
    loadConfig()
      .then(async (config: ClientConfig) => {
        await api(config, "/health");
        if (!cancelled) setStatus("No saved connections.");
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <main className="list">
        <div className="list-head">
          <div>
            <h1>Connections</h1>
            <p className="sub">Saved on this Mac. Passwords stay in the keychain.</p>
          </div>
        </div>
        <p className="empty">{status}</p>
      </main>
    </div>
  );
}
