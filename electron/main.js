const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const readline = require("readline");

let goProc = null;

function secretsFile() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function readSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSecrets(all) {
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(all));
}

function startGo() {
  const token = crypto.randomBytes(32).toString("hex");
  const bin = process.env.SQLC_BIN || (app.isPackaged ? path.join(process.resourcesPath, "sql-client-server") : "");
  const cmd = bin || "go";
  const args = bin ? [] : ["run", "./cmd/server"];
  goProc = spawn(cmd, args, {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      SQLC_TOKEN: token,
      SQLC_ADDR: "127.0.0.1:0",
      SQLC_DATA_DIR: app.getPath("userData"),
    },
  });
  goProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: goProc.stdout });
    const timer = setTimeout(() => reject(new Error("database process did not become ready")), 120000);
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.ready) {
          clearTimeout(timer);
          rl.close();
          resolve({ origin: `http://127.0.0.1:${msg.port}`, token });
        }
      } catch {
        process.stdout.write(line + "\n");
      }
    });
    goProc.on("exit", (code) => {
      if (code) reject(new Error(`database process exited ${code}`));
    });
  });
}

app.setName("SQL Client");

app.whenReady().then(async () => {
  const config = await startGo();
  ipcMain.handle("config", () => config);
  ipcMain.handle("keychain:get", (_event, id) => {
    const saved = readSecrets()[id];
    if (!saved) return "";
    return safeStorage.decryptString(Buffer.from(saved, "base64"));
  });
  ipcMain.handle("keychain:set", (_event, id, password) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The OS keychain is not available.");
    }
    const all = readSecrets();
    all[id] = safeStorage.encryptString(password).toString("base64");
    writeSecrets(all);
  });
  ipcMain.handle("keychain:delete", (_event, id) => {
    const all = readSecrets();
    delete all[id];
    writeSecrets(all);
  });
  ipcMain.handle("save-file", async (_event, filename, contents) => {
    const picked = await dialog.showSaveDialog({ defaultPath: filename });
    if (picked.canceled || !picked.filePath) return;
    fs.writeFileSync(picked.filePath, contents);
  });
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
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
});

app.on("before-quit", () => {
  if (goProc) goProc.kill();
});
