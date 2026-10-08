import { useEffect, useState } from "react";
import { loadConfig, type ClientConfig } from "./api";
import { Connections } from "./connections";

export function App() {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: Error) => setError(err.message));
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
      {error && <p className="empty">{error}</p>}
      {config && <Connections config={config} />}
    </div>
  );
}
