import { useEffect, useState, type FormEvent } from "react";
import { api, type ClientConfig } from "./api";

export type LiveConnection = {
  sessionId: string;
  engine: string;
  database: string;
  readOnly: boolean;
  name: string;
  connectionId?: string;
};

export type Connection = {
  id: string;
  name: string;
  engine: "PostgreSQL" | "MySQL";
  host: string;
  port: string;
  user: string;
  database: string;
  tls: "Off" | "Require" | "Verify";
  readOnly: boolean;
};

const empty = (): Connection => ({
  id: "",
  name: "",
  engine: "PostgreSQL",
  host: "localhost",
  port: "5432",
  user: "",
  database: "",
  tls: "Off",
  readOnly: false,
});

async function keychainSet(id: string, password: string) {
  if (!window.sqlc?.keychain) {
    throw new Error("Open the desktop app to store a password in the keychain.");
  }
  await window.sqlc.keychain.set(id, password);
}

async function keychainDelete(id: string) {
  await window.sqlc?.keychain?.delete(id);
}

export function Connections({ config, onConnect }: { config: ClientConfig; onConnect: (session: LiveConnection) => void }) {
  const [rows, setRows] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Connection | null>(null);
  const [password, setPassword] = useState("");
  const [portTouched, setPortTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testLine, setTestLine] = useState("");
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [signingIn, setSigningIn] = useState<Connection | null>(null);
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [savePassword, setSavePassword] = useState(false);

  async function reload() {
    setRows(await api<Connection[]>(config, "/connections"));
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(err.message));
  }, []);

  function openNew() {
    setForm(empty());
    setPassword("");
    setPortTouched(false);
    setEditing(false);
    setTestLine("");
  }

  function openEdit(row: Connection) {
    setForm({ ...row });
    setPassword("");
    setPortTouched(true);
    setEditing(true);
    setTestLine("");
  }

  function openDuplicate(row: Connection) {
    setForm({ ...row, id: "", name: row.name + " copy" });
    setPassword("");
    setPortTouched(true);
    setEditing(false);
    setTestLine("");
  }

  async function onTest() {
    if (!form) return;
    setTestLine("");
    try {
      await api(config, "/connections/test", {
        method: "POST",
        body: JSON.stringify({ ...form, password }),
      });
      setTestLine(`Server responded to SELECT 1 on ${form.host}:${form.port}.`);
    } catch (err) {
      setTestLine(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const path = editing ? `/connections/${form.id}` : "/connections";
    const method = editing ? "PATCH" : "POST";
    const saved = await api<Connection>(config, path, { method, body: JSON.stringify(form) });
    if (password) await keychainSet(saved.id, password);
    setForm(null);
    await reload();
  }

  function rememberedPassword(id: string): string | null {
    try {
      const value = sessionStorage.getItem(`sqlc.pw.${id}`);
      return value === null ? null : value;
    } catch {
      return null;
    }
  }

  function rememberPassword(id: string, value: string) {
    try {
      sessionStorage.setItem(`sqlc.pw.${id}`, value);
    } catch {
      /* this tab can still connect */
    }
  }

  function forgetPassword(id: string) {
    try {
      sessionStorage.removeItem(`sqlc.pw.${id}`);
    } catch {
      /* nothing stored */
    }
  }

  function askPassword(row: Connection, message = "") {
    setSigningIn(row);
    setSignInPassword("");
    setSignInError(message);
    setSavePassword(Boolean(window.sqlc?.keychain));
  }

  async function openSession(row: Connection, value: string) {
    const opened = await api<{ sessionId: string; engine: string; database: string; readOnly: boolean; connectionId: string }>(
      config,
      "/sessions",
      { method: "POST", body: JSON.stringify({ connectionId: row.id, password: value, role: "explorer" }) },
    );
    onConnect({ ...opened, name: row.name });
  }

  async function connect(row: Connection) {
    setError("");
    if (window.sqlc?.keychain) {
      try {
        const saved = (await window.sqlc.keychain.get(row.id)) || "";
        try {
          await openSession(row, saved);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Connect failed");
        }
        return;
      } catch {
        askPassword(row);
        return;
      }
    }
    const saved = rememberedPassword(row.id);
    if (saved !== null) {
      try {
        await openSession(row, saved);
      } catch (err) {
        forgetPassword(row.id);
        askPassword(row, err instanceof Error ? err.message : "Connect failed");
      }
      return;
    }
    askPassword(row);
  }

  async function submitSignIn(event: FormEvent) {
    event.preventDefault();
    if (!signingIn) return;
    setSignInError("");
    try {
      if (savePassword && signInPassword && window.sqlc?.keychain) await keychainSet(signingIn.id, signInPassword);
      await openSession(signingIn, signInPassword);
      if (!window.sqlc?.keychain) rememberPassword(signingIn.id, signInPassword);
      setSigningIn(null);
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : "Connect failed");
    }
  }

  async function onDelete() {
    if (!deleting) return;
    await api(config, `/connections/${deleting.id}`, { method: "DELETE" });
    await keychainDelete(deleting.id);
    setDeleting(null);
    await reload();
  }

  return (
    <main className="list">
      <div className="list-head">
        <div>
          <h1>Connections</h1>
          <p className="sub">Saved on this Mac. Passwords stay in the keychain.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={openNew}>
          New connection
        </button>
      </div>
      {error && <p className="empty">{error}</p>}
      {!error && rows.length === 0 && <p className="empty">No saved connections.</p>}
      <div>
        {rows.map((row) => (
          <div className="conn-row" key={row.id}>
            <div className="conn-name">{row.name}</div>
            <div>
              <div>
                {row.user}@{row.host}:{row.port}
              </div>
              <div className="meta">{row.database || "No default database"}</div>
            </div>
            <div className="badges">
              <span className="badge">{row.engine}</span>
              <span className="badge">TLS {row.tls}</span>
              {row.readOnly && <span className="badge">Read-only</span>}
            </div>
            <div className="row-actions">
              <button className="btn btn-quiet" type="button" onClick={() => openEdit(row)}>
                Edit
              </button>
              <button className="btn btn-quiet" type="button" onClick={() => openDuplicate(row)}>
                Duplicate
              </button>
              <button className="btn btn-quiet" type="button" onClick={() => setDeleting(row)}>
                Delete
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void connect(row)}
              >
                Connect
              </button>
            </div>
          </div>
        ))}
      </div>
      {form && (
        <div className="scrim">
          <form className="sheet" onSubmit={onSave}>
            <h2>{editing ? "Edit connection" : "New connection"}</h2>
            <p className="help">The password is stored in the OS keychain, not in the connection file.</p>
            <div className="fields">
              <label className="field">
                Name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="field">
                Engine
                <select
                  value={form.engine}
                  onChange={(e) => {
                    const engine = e.target.value as Connection["engine"];
                    const next = { ...form, engine };
                    if (!portTouched) next.port = engine === "MySQL" ? "3306" : "5432";
                    setForm(next);
                  }}
                >
                  <option>PostgreSQL</option>
                  <option>MySQL</option>
                </select>
              </label>
              <label className="field">
                Host
                <input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </label>
              <label className="field">
                Port
                <input
                  required
                  value={form.port}
                  onChange={(e) => {
                    setPortTouched(true);
                    setForm({ ...form, port: e.target.value });
                  }}
                />
              </label>
              <label className="field">
                Username
                <input required value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
              </label>
              <label className="field">
                Password
                <input
                  type="password"
                  value={password}
                  placeholder={editing ? "Unchanged if left blank" : "Optional"}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="field">
                Database
                <input
                  value={form.database}
                  placeholder="Optional"
                  onChange={(e) => setForm({ ...form, database: e.target.value })}
                />
              </label>
              <label className="field">
                TLS
                <select value={form.tls} onChange={(e) => setForm({ ...form, tls: e.target.value as Connection["tls"] })}>
                  <option>Off</option>
                  <option>Require</option>
                  <option>Verify</option>
                </select>
              </label>
              <label className="check span-2">
                <input
                  type="checkbox"
                  checked={form.readOnly}
                  onChange={(e) => setForm({ ...form, readOnly: e.target.checked })}
                />
                Read-only connection
              </label>
            </div>
            <p className="help">Require encrypts without checking the certificate. Verify checks it. Default ports are 5432 and 3306.</p>
            <p className={testLine.startsWith("Server") ? "test-line" : "test-line bad"}>{testLine}</p>
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={onTest}>
                Test connection
              </button>
              <span className="spacer" />
              <button className="btn" type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      {signingIn && (
        <div className="scrim">
          <form className="sheet narrow" onSubmit={(event) => void submitSignIn(event)}>
            <h2>Password for {signingIn.name}</h2>
            <p className="help">
              {window.sqlc?.keychain
                ? "The keychain did not return a password. Enter it to connect."
                : "The browser cannot read the keychain. This password is used for this tab only."}
            </p>
            <label className="field">
              Password
              <input
                type="password"
                value={signInPassword}
                autoFocus
                onChange={(e) => setSignInPassword(e.target.value)}
              />
            </label>
            {window.sqlc?.keychain && (
              <label className="check">
                <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
                Save in keychain
              </label>
            )}
            {signInError && <p className="test-line bad">{signInError}</p>}
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={() => setSigningIn(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit">
                Connect
              </button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div className="scrim">
          <div className="sheet narrow">
            <h2>Delete connection</h2>
            <p>
              Delete {deleting.name}? The keychain item is removed. Nothing is dropped on the server.
            </p>
            <div className="sheet-actions">
              <button className="btn" type="button" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
