import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";

type ReadyMessage = { ready?: boolean; port?: number };
type AppConfig = { origin: string; token: string };
type SecretMap = Record<string, string>;

let goProc: ChildProcessWithoutNullStreams | null = null;

function secretsFile(): string {
  return path.join(app.getPath("userData"), "secrets.json");
}

function readSecrets(): SecretMap {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), "utf8")) as SecretMap;
  } catch {
    return {};
  }
}

function writeSecrets(all: SecretMap): void {
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(all));
}

function startGo(): Promise<AppConfig> {
  const token = crypto.randomBytes(32).toString("hex");
  const bin = process.env.SQLC_BIN || (app.isPackaged ? path.join(process.resourcesPath, "sql-client-server") : "");
  const cmd = bin || "go";
  const args = bin ? [] : ["run", "./cmd/server"];
  const cwd = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  goProc = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      SQLC_TOKEN: token,
      SQLC_ADDR: "127.0.0.1:0",
      SQLC_DATA_DIR: app.getPath("userData"),
    },
  });
  const proc = goProc;
  proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: proc.stdout });
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("database process did not become ready"))), 120000);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      fn();
    };
    rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line) as ReadyMessage;
        if (msg.ready && msg.port) {
          finish(() => resolve({ origin: `http://127.0.0.1:${msg.port}`, token }));
        }
      } catch {
        process.stdout.write(`${line}\n`);
      }
    });
    proc.on("exit", (code) => {
      if (code) finish(() => reject(new Error(`database process exited ${code}`)));
    });
  });
}

function placeOnCursorDisplay(win: BrowserWindow): void {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1280, area.width - 40);
  const height = Math.min(840, area.height - 40);
  win.setBounds({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  });
}

app.setName("SQL Client");

app.whenReady().then(async () => {
  try {
    const config = await startGo();
    ipcMain.handle("config", () => config);
    ipcMain.handle("keychain:get", (_event, id: string) => {
      const saved = readSecrets()[id];
      if (!saved) return "";
      return safeStorage.decryptString(Buffer.from(saved, "base64"));
    });
    ipcMain.handle("keychain:set", (_event, id: string, password: string) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("The OS keychain is not available.");
      }
      const all = readSecrets();
      all[id] = safeStorage.encryptString(password).toString("base64");
      writeSecrets(all);
    });
    ipcMain.handle("keychain:delete", (_event, id: string) => {
      const all = readSecrets();
      delete all[id];
      writeSecrets(all);
    });
    ipcMain.handle("save-file", async (_event, filename: string, contents: string) => {
      const picked = await dialog.showSaveDialog({ defaultPath: filename });
      if (picked.canceled || !picked.filePath) return;
      fs.writeFileSync(picked.filePath, contents);
    });
    const win = new BrowserWindow({
      width: 1280,
      height: 840,
      show: true,
      title: "SQL Client",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    if (app.isPackaged) {
      await win.loadFile(path.join(process.resourcesPath, "web", "index.html"));
    } else {
      await win.loadURL(process.env.SQLC_WEB || "http://127.0.0.1:5173");
    }
    placeOnCursorDisplay(win);
    win.show();
    win.focus();
    win.moveTop();
    app.focus({ steal: true });
  } catch (err) {
    dialog.showErrorBox("SQL Client could not start", err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

app.on("before-quit", () => {
  goProc?.kill();
});
