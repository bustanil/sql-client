import { spawn, type ChildProcess } from "node:child_process";

const web: ChildProcess = spawn("npm", ["run", "dev"], { cwd: "web", stdio: "inherit" });
const electron: ChildProcess = spawn("npx", ["electron", "."], {
  env: { ...process.env, SQLC_WEB: "http://127.0.0.1:5173" },
  stdio: "inherit",
});

function stop(): void {
  electron.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  web.kill();
  process.exit(code ?? 0);
});
