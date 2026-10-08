const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const readline = require("readline");

let goProc = null;

function startGo() {
  const token = crypto.randomBytes(32).toString("hex");
  const bin = process.env.SQLC_BIN;
  const cmd = bin || "go";
  const args = bin ? [] : ["run", "./cmd/server"];
  goProc = spawn(cmd, args, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, SQLC_TOKEN: token, SQLC_ADDR: "127.0.0.1:0" },
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

app.whenReady().then(async () => {
  const config = await startGo();
  ipcMain.handle("config", () => config);
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
  await win.loadURL(process.env.SQLC_WEB || "http://127.0.0.1:5173");
});

app.on("before-quit", () => {
  if (goProc) goProc.kill();
});
